// asr-worker.js — ASR Whisper dans un Web Worker (browser-whisper 1.1.0).
// Quant hybride par défaut de la lib : encodeur fp32 + décodeur q4 (source : README browser-whisper).
// Entrée : Float32Array 16 kHz mono (segments VAD). Sortie : transcription finale (+ partiels).
// Remplaçable : si browser-whisper échoue sur l'appareil, passer le flag TRANSFORMERS_ASR_FALLBACK
// côté main (adaptateur — voir docs/architecture.md).

import { BrowserWhisper } from 'https://cdn.jsdelivr.net/npm/browser-whisper@1.1.0/+esm';

let whisper = null;
let busy = false;
const queue = [];

const post = (msg) => self.postMessage(msg, msg.transfer || []);

async function pump() {
  if (busy || queue.length === 0 || !whisper) return;
  busy = true;
  const { id, pcm } = queue.shift();
  const t0 = performance.now();
  try {
    const segments = await whisper.transcribePCM(pcm, {
      language: whisper?.language,
      onSegment: (seg) => post({ id, type: 'partial', payload: { text: seg.text, ms: Math.round(performance.now() - t0) } }),
    }).collect();
    const text = (segments || []).map((s) => s.text).join(' ').trim();
    post({ id, type: 'final', payload: { text, ms: Math.round(performance.now() - t0) } });
  } catch (err) {
    post({ id, type: 'error', payload: { name: err?.name, message: err?.message } });
  } finally {
    busy = false;
    pump();
  }
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    switch (type) {
      case 'init': {
        const { model, language } = payload;
        whisper = new BrowserWhisper({
          model,
          language: language || undefined, // undefined → auto-detect
        });
        post({ id, type: 'progress', payload: { stage: 'checking', progress: 0 } });
        await whisper.downloadModel({
          onProgress: ({ stage, progress }) => {
            post({ id, type: 'progress', payload: { stage: stage || 'download', progress: progress || 0 } });
          },
        });
        post({ id, type: 'progress', payload: { stage: 'ready', progress: 1 } });
        post({ id, type: 'ready' });
        break;
      }
      case 'transcribe': {
        queue.push({ id, pcm: payload.pcm });
        pump();
        break;
      }
      case 'abort': {
        // vide la file (le segment en cours finit — coût faible : un segment VAD)
        queue.length = 0;
        break;
      }
    }
  } catch (err) {
    post({ id, type: 'error', payload: { name: err?.name, message: err?.message, stack: err?.stack } });
  }
};
