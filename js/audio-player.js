// audio-player.js — lecture Web Audio API + coupure immédiate (barge-in).
// Protection mémoire : Set de sources actives + nettoyage onended + garde de
// simultanéité (maxConcurrent). Pas de file d'attente séparée (code mort supprimé).

import { log } from './logger.js';

export class AudioPlayer {
  constructor() {
    this.ctx = null;
    this.sources = new Set();
    this.nextTime = 0;
    this.maxConcurrent = 24; // garde réelle : sources jouées simultanément
    this.playing = false;
  }

  // Doit être appelé depuis un geste utilisateur (autoplay policy).
  ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.nextTime = this.ctx.currentTime + 0.05;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  // float32 PCM, sampleRate natif du modèle (Kokoro = 24000 Hz).
  // AudioBufferSourceNode rééchantillonne automatiquement vers la fréquence du contexte.
  play(float32, sampleRate) {
    const ctx = this.ensureContext();
    if (!ctx) return;
    // garde réelle : trop de sources en même temps → stopper la plus ancienne
    if (this.sources.size >= this.maxConcurrent) {
      const oldest = this.sources.values().next().value;
      try { oldest.stop(); } catch {}
    }

    const buffer = ctx.createBuffer(1, float32.length, sampleRate || ctx.sampleRate);
    buffer.copyToChannel(float32, 0);

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 1.0;
    source.connect(gain).connect(ctx.destination);

    source.onended = () => {
      this.sources.delete(source);
      this._maybeEnd();
    };
    this.sources.add(source);
    this.playing = true;

    source.start(this.nextTime);
    this.nextTime = Math.max(this.nextTime + buffer.duration, ctx.currentTime + buffer.duration + 0.01);
    log.debug('audio', `enqueue ${(buffer.duration * 1000).toFixed(0)}ms`);
  }

  // Barge-in : coupe immédiatement tout ce qui est en cours + purge la file.
  stopAll() {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* déjà stoppé */ }
      s.disconnect?.();
    }
    this.sources.clear();
    this.nextTime = this.ctx ? this.ctx.currentTime : 0;
    this.playing = false;
    log.info('audio', 'Lecture coupée (barge-in)');
  }

  _maybeEnd() {
    if (this.sources.size === 0) this.playing = false;
  }

  get isPlaying() { return this.playing; }
}
