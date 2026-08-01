// ui.js — DOM : états, bulles, progression, panneaux debug/réglages, mobile-first.

import { log } from './logger.js';

const $ = (sel) => document.querySelector(sel);

const STATE_LABELS = {
  boot: 'Démarrage', init: 'Chargement…', idle: 'Prêt',
  listening: 'Écoute…', processing: 'Traite…', speaking: 'Parle…',
};

export class UI {
  constructor() {
    this.el = {
      status: $('#status-pill'), mic: $('#btn-mic'), banner: $('#banner'),
      transcript: $('#transcript'), empty: $('#empty-state'),
      progress: $('#progress-panel'), debug: $('#debug-panel'), settings: $('#settings-panel'),
      caps: $('#debug-caps'), metrics: $('#debug-metrics'), logs: $('#debug-logs'),
      profileBadge: $('#profile-badge'),
      textInput: $('#text-input'), send: $('#btn-send'),
    };
    this.partialBubble = null;
    this.handlers = {};
  }

  init(handlers) {
    this.handlers = handlers;
    this.el.mic.addEventListener('click', () => handlers.onToggleMic?.());
    this.el.send.addEventListener('click', () => this._sendText());
    this.el.textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') this._sendText(); });
    $('#btn-debug').addEventListener('click', () => this.toggleDebug(true));
    $('#btn-debug-close').addEventListener('click', () => this.toggleDebug(false));
    $('#btn-settings').addEventListener('click', () => this.toggleSettings(true));
    $('#btn-settings-close').addEventListener('click', () => this.toggleSettings(false));
    for (const id of ['set-profile', 'set-language', 'set-voice', 'set-tts', 'set-partial', 'set-maxtokens']) {
      $(`#${id}`).addEventListener('change', () => handlers.onSettingsChange?.(this.readSettings()));
    }
    log.onLog((entry) => this._appendLog(entry));
  }

  readSettings() {
    return {
      profile: $('#set-profile').value,
      language: $('#set-language').value,
      voice: $('#set-voice').value,
      ttsMode: $('#set-tts').value,
      partial: $('#set-partial').checked,
      maxTokens: parseInt($('#set-maxtokens').value, 10) || 200,
    };
  }

  writeSettings(s) {
    $('#set-profile').value = s.profile;
    $('#set-language').value = s.language;
    $('#set-voice').value = s.voice;
    $('#set-tts').value = s.ttsMode;
    $('#set-partial').checked = s.partial;
    $('#set-maxtokens').value = s.maxTokens;
  }

  _sendText() {
    const t = this.el.textInput.value;
    if (!t.trim()) return;
    this.el.textInput.value = '';
    this.handlers.onSendText?.(t);
  }

  // ---------- état / statut ----------
  setState(state) {
    const label = STATE_LABELS[state] || state;
    this.el.status.textContent = label;
    this.el.status.dataset.state = state;
    this.el.mic.classList.toggle('active', state === 'listening');
    this.el.mic.classList.toggle('speaking', state === 'speaking');
    this.el.mic.classList.toggle('listening', state === 'listening');
  }

  setProfileBadge(text) { this.el.profileBadge.textContent = text; }

  banner(msg, level = 'error', ms = 8000) {
    this.el.banner.textContent = msg;
    this.el.banner.classList.remove('hidden');
    this.el.banner.classList.toggle('warn', level === 'warn');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => this.el.banner.classList.add('hidden'), ms);
  }

  // ---------- bulles ----------
  addUser(text) {
    this._clearPartial();
    this.el.empty?.classList.add('hidden');
    this._append('user', text);
  }

  addUserPartial(text) {
    if (!this.partialBubble) {
      this.el.empty?.classList.add('hidden');
      this.partialBubble = this._append('user', text, true);
    } else {
      this.partialBubble.querySelector('.content').textContent = text;
    }
  }

  addAssistant(text) {
    const node = this._append('assistant', text || '…');
    node.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  updateAssistantDelta(delta, reset) {
    if (reset) {
      this.el.empty?.classList.add('hidden');
      this.assistantNode = this._append('assistant', '', false);
      this.assistantNode.querySelector('.content').textContent = '';
    }
    if (!this.assistantNode) return;
    const c = this.assistantNode.querySelector('.content');
    c.textContent += delta;
    // curseur
    if (!this.cursor) {
      this.cursor = document.createElement('span');
      this.cursor.className = 'cursor';
      c.appendChild(this.cursor);
    }
    this.assistantNode.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }

  finalizeAssistant(text) {
    if (this.cursor) { this.cursor.remove(); this.cursor = null; }
    if (this.assistantNode) {
      const c = this.assistantNode.querySelector('.content');
      c.textContent = text || c.textContent;
      this.assistantNode.classList.remove('partial');
    }
    this.assistantNode = null;
  }

  _append(role, text, partial) {
    const node = document.createElement('div');
    node.className = `msg ${role}${partial ? ' partial' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'meta';
    const who = role === 'user' ? 'Vous' : 'Assistant';
    meta.textContent = `${who} · ${new Date().toLocaleTimeString('fr-FR', { hour12: false })}`;
    const content = document.createElement('div');
    content.className = 'content';
    content.textContent = text;
    node.appendChild(meta);
    node.appendChild(content);
    this.el.transcript.appendChild(node);
    node.scrollIntoView({ block: 'end' });
    return node;
  }

  _clearPartial() {
    if (this.partialBubble) { this.partialBubble.remove(); this.partialBubble = null; }
  }

  // ---------- progression ----------
  progress(name, stage, pct) {
    this.el.progress.classList.remove('hidden');
    const row = this.el.progress.querySelector(`[data-model="${name}"]`);
    if (!row) return;
    const fill = row.querySelector('[data-fill]');
    const txt = row.querySelector('[data-text]');
    const p = Math.round((pct || 0) * 100);
    fill.style.width = `${p}%`;
    const stageLabel = stage === 'checking' ? 'vérif cache' : stage === 'download' ? `téléchargement ${p}%` : stage === 'ready' ? 'prêt' : stage;
    txt.textContent = stageLabel;
    if (stage === 'ready') fill.style.background = 'linear-gradient(90deg,#22c55e,#4ade80)';
  }

  hideProgress() { this.el.progress.classList.add('hidden'); }

  // ---------- debug ----------
  toggleDebug(open) {
    this.el.debug.classList.toggle('hidden', !open);
    // réutilise les valeurs stockées au boot (évite d'écraser l'affichage avec undefined)
    if (open && this._caps) this.renderCaps(this._caps, this._profile);
  }
  toggleSettings(open) {
    this.el.settings.classList.toggle('hidden', !open);
  }

  renderCaps(caps, profile) {
    this._caps = caps;
    this._profile = profile;
    this.el.caps.textContent = JSON.stringify(caps, null, 1) + `\nprofil: ${profile}`;
  }

  renderMetrics(m) {
    this.el.metrics.textContent = m.table();
  }

  _appendLog(entry) {
    const line = `${new Date(entry.t).toISOString().slice(11, 19)} [${entry.tag}] ${entry.msg}`;
    const div = document.createElement('div');
    div.textContent = line;
    const color = entry.level >= 3 ? '#f87171' : entry.level === 2 ? '#fbbf24' : '#9aa1b0';
    div.style.color = color;
    this.el.logs.appendChild(div);
    while (this.el.logs.childNodes.length > 200) this.el.logs.removeChild(this.el.logs.firstChild);
  }
}
