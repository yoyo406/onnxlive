// session.js — orchestration du pipeline streaming (GPT-Live like).
// Workers séparés : LLM / ASR / TTS. VAD en continu → barge-in. Latence mesurée à chaque étape.

import { PROFILES, buildSystemPrompt, TEMPERATURE, HISTORY_LIMIT } from './config.js';
import { VadManager } from './vad-manager.js';
import { AudioPlayer } from './audio-player.js';
import { Metrics } from './metrics.js';
import { log } from './logger.js';
import { downgradeProfile } from './device.js';

const workerUrl = (name) => new URL(`./workers/${name}.js`, import.meta.url);

export class Session {
  /**
   * @param {object} opts
   * @param {object} opts.caps      — capacités détectées (device.js)
   * @param {string} opts.profile   — profil actif
   * @param {object} opts.settings  — réglages utilisateur
   * @param {object} opts.ui        — callbacks : onState,onProgress,onUserText,onUserPartial,
   *                                  onAssistantDelta,onAssistantFinal,onMetrics,onBanner
   */
  constructor({ caps, profile, settings, ui }) {
    this.caps = caps;
    this.profile = profile;
    this.settings = settings;
    this.ui = ui;
    this.state = 'boot';

    this.metrics = new Metrics();
    this.player = new AudioPlayer();
    this.vad = new VadManager({
      onSpeechStart: () => this._onSpeechStart(),
      onOngoing: (seg) => this._onOngoing(seg),
      onSegment: (seg) => this._onSegment(seg),
      onProgress: (stage, pct) => this.ui.onProgress?.('vad', stage, pct),
    });

    this.workers = { llm: null, asr: null, tts: null };
    this.pending = new Map();   // id → {resolve, reject, name, type}
    this.history = [];
    this.pendingAsr = false;
    this.ttsOpen = false;
    this.assistantBuf = '';
    this._id = 0;
    this._turn = 0;             // token de tour : invalide les réponses périmées
    this._turnActive = 0;       // tour courant côté LLM/TTS
    this._lastLang = null;
  }

  // ---------- infra workers ----------
  _nextId() { return ++this._id; }

  _spawn(name) {
    if (typeof window !== 'undefined' && !window.isSecureContext) {
      const msg = 'Contexte non sécurisé : les workers modules sont bloqués par le navigateur (HTTPS ou localhost requis). ' +
        'Teste sur http://localhost:8080, ou déploie sur GitHub Pages (HTTPS).';
      log.error('worker', `${name} : ${msg}`);
      this.ui.onBanner?.('error', msg);
    }
    const w = new Worker(workerUrl(name), { type: 'module' });
    w.onerror = (e) => {
      // e.message peut être vide (SecurityError silencieux) — ajouter file/line aide à distinguer
      // erreur réseau (CDN) vs blocage de contexte (module worker hors HTTPS/localhost).
      log.error('worker', `Échec chargement worker ${name}`, {
        message: e.message,
        file: e.filename,
        line: e.lineno,
        col: e.colno,
      });
      this._rejectAll(name, `worker ${name} : ${e.message || 'module worker error'}`);
      this.ui.onBanner?.('error', `Worker ${name} injoignable.` + (window.isSecureContext ? ' (réseau/CDN ?)' : ' (contexte non sécurisé — utilise localhost ou HTTPS).'));
    };
    w.onmessage = (e) => this._onWorkerMessage(name, e.data);
    this.workers[name] = w;
    return w;
  }

  _rejectAll(name, msg) {
    for (const [id, p] of this.pending) {
      if (p.name === name) { this.pending.delete(id); p.reject(new Error(msg)); }
    }
  }

  _onWorkerMessage(name, msg) {
    const { id, type, payload } = msg;
    if (type === 'progress') { this.ui.onProgress?.(name, payload.stage, payload.progress); return; }
    if (type === 'error') {
      const pend = id != null ? this.pending.get(id) : null;
      if (pend) { this.pending.delete(id); pend.reject(new Error(`${name}: ${payload?.message || 'worker error'}`)); }
      else this._onModelError(name, payload);
      return;
    }
    // réponses aux requêtes (id + type terminal)
    if (id != null && (type === 'ready' || type === 'done' || type === 'final' || type === 'aborted')) {
      const pend = this.pending.get(id);
      if (pend) { this.pending.delete(id); pend.resolve(payload); }
      return;
    }
    // événements sans id
    switch (`${name}:${type}`) {
      case 'llm:token': this._onLlmToken(payload); break;
      case 'llm:firstToken': this.metrics.mark('llmFirstToken'); break;
      case 'tts:audio': this._onTtsAudio(payload); break;
      case 'tts:streamEnd': this._onTtsEnd(); break;
      default: break; // partiels ASR informatif, etc.
    }
  }

  _request(name, type, payload, { timeout = 120000 } = {}) {
    const id = this._nextId();
    const w = this.workers[name];
    if (!w) return Promise.reject(new Error(`worker ${name} non démarré`));
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${name}.${type}`)); }, timeout);
      this.pending.set(id, {
        name,
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      w.postMessage({ id, type, payload });
    });
  }

  // ---------- cycle de vie ----------
  async init() {
    this.state = 'init';
    this.ui.onState?.(this.state);
    const prof = PROFILES[this.profile];

    this._spawn('llm');
    this._spawn('asr');
    this._spawn('tts');

    const llmP = this._request('llm', 'init', { model: prof.llm.model, dtype: prof.llm.dtype, device: prof.llm.device })
      .catch((err) => this._handleLlmInitError(prof.llm.model, err));
    const asrP = this._request('asr', 'init', { model: prof.asr.model, language: this.settings.language })
      .catch((err) => this._handleAsrInitError(prof.asr.model, err));
    const ttsP = this._request('tts', 'init', {
      modelId: 'onnx-community/Kokoro-82M-v1.0-ONNX',
      dtype: this.settings.ttsMode.startsWith('q8') ? 'q8' : 'fp32',
      device: this.settings.ttsMode.endsWith('webgpu') ? 'webgpu' : 'wasm',
      voice: this.settings.voice,
    }).catch((err) => this._handleTtsInitError(err));

    await Promise.all([llmP, asrP, ttsP]);
    this._lastLang = this.settings.language;
    this.state = 'idle';
    this.ui.onState?.(this.state);
    log.info('session', `Initialisé — profil ${this.profile} (${PROFILES[this.profile].label})`);
  }

  _handleLlmInitError(llmModel, err) {
    log.error('llm', `Échec init LLM (${llmModel}) — downgrade`, err.message);
    const next = downgradeProfile(this.profile, err?.message || '');
    if (next) {
      this.profile = next;
      this.ui.onBanner?.('warn', `LLM ${llmModel} impossible (${err.message.slice(0, 90)}). Profil → ${next}.`);
      const prof = PROFILES[next];
      this.workers.llm?.terminate();
      this._spawn('llm');
      return this._request('llm', 'init', { model: prof.llm.model, dtype: prof.llm.dtype, device: prof.llm.device });
    }
    this.ui.onBanner?.('error', `Appareil insuffisant pour le LLM : ${err.message.slice(0, 120)}`);
    throw err;
  }

  _handleAsrInitError(model, err) {
    log.error('asr', `Échec init ASR (${model})`, err.message);
    if (model !== 'whisper-tiny') {
      this.ui.onBanner?.('warn', `ASR ${model} impossible — fallback whisper-tiny.`);
      this.workers.asr?.terminate();
      this._spawn('asr');
      return this._request('asr', 'init', { model: 'whisper-tiny', language: this.settings.language });
    }
    this.ui.onBanner?.('error', `ASR impossible : ${err.message.slice(0, 120)}`);
    throw err;
  }

  _handleTtsInitError(err) {
    log.error('tts', 'Échec init TTS', err.message);
    this.ui.onBanner?.('error', `TTS impossible : ${err.message.slice(0, 120)}`);
    throw err;
  }

  _onModelError(name, payload) {
    log.error('model', `Erreur runtime ${name}`, payload);
    this.ui.onBanner?.('error', `${name} : ${payload?.message?.slice(0, 100) || 'erreur inconnue'}`);
  }

  // ---------- micro / VAD ----------
  toggleMic() {
    if (this.state === 'idle') return this.startMic();
    if (this.state === 'listening') return this.stopMic();
    if (this.state === 'boot' || this.state === 'init') this.ui.onBanner?.('warn', 'Initialisation en cours…');
  }

  async startMic() {
    try {
      this.player.ensureContext(); // geste utilisateur → AudioContext OK
      await this.vad.start();      // @ricky0123/vad-web (MicVAD) gère getUserMedia + permission
      this.state = 'listening';
      this.ui.onState?.(this.state);
      log.info('session', 'Écoute active (VAD continu, barge-in armé)');
    } catch (err) {
      const msg = `${err?.message || ''} ${err?.name || ''}`;
      if (/notallowed|permission|denied/i.test(msg)) {
        this.ui.onBanner?.('error', 'Permission micro refusée. Autorise le micro (HTTPS requis — GitHub Pages le fournit) puis réessaie.');
      } else if (/notfound/i.test(msg) || err?.name === 'NotFoundError') {
        this.ui.onBanner?.('error', 'Aucun microphone détecté.');
      } else {
        this.ui.onBanner?.('error', `Erreur micro : ${err.message}`);
      }
      log.error('mic', 'Échec démarrage micro', err);
    }
  }

  stopMic() {
    this.vad.stop();
    this.player.stopAll();
    this.state = 'idle';
    this.ui.onState?.(this.state);
  }

  // ---------- pipeline vocal ----------
  _onSpeechStart() {
    this.metrics.mark('turnStart');
    this.metrics.mark('vadTrigger');
    if (this.state === 'speaking' || this.state === 'processing') {
      this._bargeIn();
      return;
    }
    log.debug('session', 'Parole détectée (VAD)');
  }

  _onOngoing(seg) {
    // transcription partielle (~1/s pendant la parole) — uniquement si ASR libre
    if (!this.settings.partial || this.state !== 'listening' || this.pendingAsr) return;
    this._transcribe(seg, true);
  }

  _onSegment(seg) {
    // segment final : toujours traité (le token de tour neutralise les doublons/périmés)
    this._transcribe(seg, false);
  }

  _transcribe(seg, partial) {
    const turn = ++this._turn;           // invalide les tours précédents
    this.pendingAsr = true;
    if (!partial) {
      this.state = 'processing';
      this.ui.onState?.(this.state);
    }
    const t0 = performance.now();

    this._request('asr', 'transcribe', { pcm: seg.audio })
      .then((res) => {
        const text = (res?.text || '').trim();
        if (turn !== this._turn) return; // périmé (barge-in pendant l'ASR)
        this.pendingAsr = false;
        if (partial) {
          this.metrics.mark('asrPartial');
          this.ui.onUserPartial?.(text);
          return;
        }
        this.metrics.mark('asrFinal');
        if (!text) {
          this.state = 'listening';
          this.ui.onState?.(this.state);
          return;
        }
        this.ui.onUserText?.(text);
        log.info('asr', `transcription (${Math.round(performance.now() - t0)}ms) : ${text}`);
        this._respond(text, turn);
      })
      .catch((err) => {
        this.pendingAsr = false;
        if (turn !== this._turn) return;
        log.error('asr', 'Échec transcription', err.message);
        this.ui.onBanner?.('warn', `Transcription échouée : ${err.message.slice(0, 70)}`);
        this.state = 'listening';
        this.ui.onState?.(this.state);
      });
  }

  // ---------- génération + TTS streaming ----------
  async _respond(text, turn) {
    this._turnActive = turn;
    this.history.push({ role: 'user', content: text });
    if (this.history.length > HISTORY_LIMIT) this.history = this.history.slice(-HISTORY_LIMIT);

    const system = buildSystemPrompt(PROFILES[this.profile].llm.model, this.settings.language);
    const messages = [{ role: 'system', content: system }, ...this.history];

    this.assistantBuf = '';
    this.ttsOpen = false;
    this.state = 'processing';
    this.ui.onState?.(this.state);
    this.ui.onAssistantDelta?.('', true); // bulle + curseur

    try {
      this.metrics.mark('ttsStart'); // début phase TTS (base de la métrique barge_in)
      // ouvre le stream TTS (voix courante)
      await this._request('tts', 'open', { voice: this.settings.voice });
      if (turn !== this._turn) { this._abortTtsOnly(); return; } // barge-in pendant l'open
      this.ttsOpen = true;

      const res = await this._request('llm', 'generate', {
        messages,
        max_new_tokens: this.settings.maxTokens,
        temperature: TEMPERATURE,
      }, { timeout: 180000 });

      if (turn !== this._turn) return; // tour annulé (barge-in) : ne pas finaliser

      // fin du texte LLM → flush + close du stream TTS
      this.workers.tts.postMessage({ type: 'flush' });
      setTimeout(() => this.workers.tts.postMessage({ type: 'close' }), 150);

      const full = (res?.text || this.assistantBuf).trim();
      if (full) {
        this.history.push({ role: 'assistant', content: full });
        if (this.history.length > HISTORY_LIMIT) this.history = this.history.slice(-HISTORY_LIMIT);
      }
      this.ui.onAssistantFinal?.(full);
    } catch (err) {
      if (this._isAbort(err)) return; // barge-in : pas de bandeau
      log.error('session', 'Erreur tour', err.message);
      this.ui.onBanner?.('warn', `Erreur : ${err.message.slice(0, 80)}`);
      this._abortTtsOnly();
    }
  }

  _isAbort(err) {
    return err?.name === 'AbortError' || /abort/i.test(`${err?.message || ''}`);
  }

  _abortTtsOnly() {
    try { this.workers.tts.postMessage({ type: 'abort' }); } catch {}
    this.ttsOpen = false;
  }

  _onLlmToken(payload) {
    if (this._turnActive !== this._turn) return; // tour périmé
    if (this.ttsOpen) this.workers.tts.postMessage({ type: 'text', payload: { text: payload.text } });
    this.assistantBuf += payload.text;
    this.ui.onAssistantDelta?.(payload.text, false);
  }

  _onTtsAudio(payload) {
    if (this._turnActive !== this._turn) return; // audio d'un tour aborté
    if (this.metrics.marks['ttsFirstChunk'] === undefined) this.metrics.mark('ttsFirstChunk');
    this.state = 'speaking';
    this.ui.onState?.(this.state);
    this.player.play(payload.audio, 24000); // Kokoro : 24 kHz (rééchantillonné par l'API Web Audio)
  }

  _onTtsEnd() {
    if (this._turnActive === this._turn) {
      this.metrics.mark('ttsEnd');
      this.metrics.endTurn();
      this.ui.onMetrics?.(this.metrics);
    }
    this.ttsOpen = false;
    const wait = () => {
      if (this.player.isPlaying) { setTimeout(wait, 150); return; }
      if (this.state !== 'idle' && this.state !== 'listening') {
        this.state = 'listening';
        this.ui.onState?.(this.state);
      }
    };
    wait();
  }

  // ---------- barge-in ----------
  _bargeIn() {
    log.info('session', 'BARGE-IN — coupure TTS + annulation LLM/TTS');
    this._turn++;                       // invalide le tour en cours
    this.metrics.mark('bargeIn');
    this.player.stopAll();
    this.workers.llm?.postMessage({ type: 'abort' });
    this.workers.tts?.postMessage({ type: 'abort' });
    this.workers.asr?.postMessage({ type: 'abort' });
    this.ttsOpen = false;
    this.pendingAsr = false;
    const partial = this.assistantBuf.trim();
    if (partial) this.ui.onAssistantFinal?.(partial); // garde ce qui a été dit
    this.assistantBuf = '';
    this.state = 'listening';
    this.ui.onState?.(this.state);
  }

  // ---------- mode texte (test sans micro) ----------
  async sendText(text) {
    const t = (text || '').trim();
    if (!t || (this.state !== 'idle' && this.state !== 'listening')) return;
    this.player.ensureContext();
    if (this.state !== 'idle') { /* écoute active : on continue quand même, VAD reste armé */ }
    this.ui.onUserText?.(t);
    await this._respond(t, ++this._turn);
  }

  // ---------- réglages live ----------
  applySettings(s) {
    this.settings = s;
    if (s.language !== this._lastLang) {
      this._lastLang = s.language;
      this.workers.asr?.terminate();
      this._spawn('asr');
      this._request('asr', 'init', { model: PROFILES[this.profile].asr.model, language: s.language }).catch(() => {});
    }
  }
}
