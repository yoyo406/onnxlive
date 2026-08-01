// vad-segmenter.js — logique pure de segmentation VAD (SANS DOM, testable en node).
// Utilisée par vad-manager pour : trim silence, fusion segments consécutifs,
// découpage des segments trop longs, cadrage 16 kHz.

const EPS = 1e-9;

// Puissance RMS d'un frame en dBFS (0 = plein échelle). Frames de silence → très négatif.
export function rmsDb(samples, from = 0, to = samples.length) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / Math.max(1, to - from));
  return 20 * Math.log10(rms + EPS);
}

// Découpe un Float32Array en frames de `frameSamples` échantillons (dernier frame paddé à zéros).
export function splitFrames(samples, frameSamples) {
  const frames = [];
  for (let i = 0; i < samples.length; i += frameSamples) {
    const f = new Float32Array(frameSamples);
    f.set(samples.subarray(i, Math.min(i + frameSamples, samples.length)));
    frames.push(f);
  }
  return frames;
}

// Retire le silence de tête/queue (seuil dBFS) d'un segment. Retourne {samples, startIdx, endIdx}.
export function trimSilence(samples, sampleRate, { thresholdDb = -35, frameMs = 20, minMs = 120 } = {}) {
  const frameSamples = Math.max(1, Math.round((sampleRate * frameMs) / 1000));
  const minSamples = Math.round((sampleRate * minMs) / 1000);
  const n = samples.length;
  if (n === 0) return { samples: new Float32Array(0), startIdx: 0, endIdx: 0 };

  let start = 0, end = n, found = false;
  // tête
  for (let i = 0; i < n; i += frameSamples) {
    const to = Math.min(i + frameSamples, n);
    if (rmsDb(samples, i, to) >= thresholdDb) { start = i; found = true; break; }
  }
  if (!found) {
    // aucun frame au-dessus du seuil : c'est du silence, on ne garde rien
    return { samples: new Float32Array(0), startIdx: 0, endIdx: 0 };
  }
  // queue
  for (let i = n - 1; i >= start; i -= frameSamples) {
    const from = Math.max(start, i - frameSamples + 1);
    if (rmsDb(samples, from, i + 1) >= thresholdDb) { end = i + 1; break; }
  }
  if (end - start < minSamples) {
    // trop court après trim : ne garde rien (bruit, clic)
    return { samples: new Float32Array(0), startIdx: 0, endIdx: 0 };
  }
  return { samples: samples.slice(start, end), startIdx: start, endIdx: end };
}

// Fusionne des segments consécutifs séparés par < gapMs de silence (une seule phrase).
// segments : [{samples, startTime, endTime}]
export function mergeGaps(segments, gapMs, sampleRate) {
  if (segments.length === 0) return [];
  const out = [segments[0]];
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1];
    const gap = (segments[i].startTime - prev.endTime) * 1000;
    if (gap >= 0 && gap < gapMs) {
      const merged = new Float32Array(prev.samples.length + segments[i].samples.length);
      merged.set(prev.samples, 0);
      merged.set(segments[i].samples, prev.samples.length);
      out[out.length - 1] = { samples: merged, startTime: prev.startTime, endTime: segments[i].endTime };
    } else {
      out.push(segments[i]);
    }
  }
  return out;
}

// Découpe un segment trop long en morceaux ≤ maxMs (ASR : fenêtre max raisonnable).
export function enforceMaxDuration(samples, sampleRate, maxMs) {
  const maxSamples = Math.round((sampleRate * maxMs) / 1000);
  if (samples.length <= maxSamples) return [samples];
  const out = [];
  for (let i = 0; i < samples.length; i += maxSamples) {
    out.push(samples.slice(i, Math.min(i + maxSamples, samples.length)));
  }
  return out;
}

// Rééchantillonne linéairement vers sampleRate cible (16 kHz pour VAD/ASR).
export function resampleToRate(samples, fromRate, toRate = 16000) {
  if (fromRate === toRate) return samples;
  const ratio = toRate / fromRate;
  const outLen = Math.round(samples.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, samples.length - 1);
    const frac = src - i0;
    out[i] = samples[i0] * (1 - frac) + samples[i1] * frac;
  }
  return out;
}

// Pipeline complet d'un segment brut VAD → segments prêts pour l'ASR.
export class SegmentPipeline {
  constructor({ sampleRate = 16000, trimThresholdDb = -35, minSpeechMs = 120, maxSegmentMs = 15000, mergeGapMs = 600 } = {}) {
    this.sampleRate = sampleRate;
    this.trimThresholdDb = trimThresholdDb;
    this.minSpeechMs = minSpeechMs;
    this.maxSegmentMs = maxSegmentMs;
    this.mergeGapMs = mergeGapMs;
  }
  // audio brut (Float32Array, n'importe quel sampleRate) → Float32Array[] de segments ASR
  process(audio, sampleRate) {
    const at16k = resampleToRate(audio, sampleRate, this.sampleRate);
    const { samples } = trimSilence(at16k, this.sampleRate, {
      thresholdDb: this.trimThresholdDb,
      minMs: this.minSpeechMs,
    });
    if (samples.length === 0) return [];
    return enforceMaxDuration(samples, this.sampleRate, this.maxSegmentMs);
  }
}
