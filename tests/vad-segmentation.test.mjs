// tests/vad-segmentation.test.mjs — tests unitaires de la logique de segmentation VAD
// (module pur js/vad-segmenter.js, sans DOM — exécutable en node).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rmsDb, splitFrames, trimSilence, mergeGaps, enforceMaxDuration,
  resampleToRate, SegmentPipeline,
} from '../js/vad-segmenter.js';

const SR = 16000;

// Signal de test : silence + ton + silence
function makeTone(freq = 440, durSec = 0.4, amp = 0.6) {
  const n = Math.round(SR * durSec);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin((2 * Math.PI * freq * i) / SR);
  return s;
}

function silence(durSec) {
  const s = new Float32Array(Math.round(SR * durSec));
  s.fill(0.0001); // quasi-silence, pas zéro strict (bruit de fond réaliste)
  return s;
}

test('rmsDb : silence très bas, ton proche de 0 dB', () => {
  assert.ok(rmsDb(silence(0.1)) < -40, `silence=${rmsDb(silence(0.1))}dB`);
  const db = rmsDb(makeTone(440, 0.1, 0.6));
  assert.ok(db > -10 && db < 0, `ton=${db}dB`);
});

test('splitFrames : découpe + pad du dernier frame', () => {
  const s = new Float32Array(1000);
  s.fill(0.5);
  const frames = splitFrames(s, 320); // 20ms @16k
  assert.equal(frames.length, 4);
  assert.equal(frames[3].length, 320);
  assert.equal(frames[3][319], 0); // padding zéros
});

test('trimSilence : retire silence de tête/queue, garde le ton', () => {
  const signal = concat([silence(0.3), makeTone(440, 0.4), silence(0.5)]);
  const { samples } = trimSilence(signal, SR);
  const expected = Math.round(0.4 * SR);
  // tolérance 1 frame (20ms) de chaque côté
  assert.ok(Math.abs(samples.length - expected) < 2 * 0.02 * SR, `len=${samples.length}, attendu≈${expected}`);
});

test('trimSilence : rejette un segment trop court (clic/bruit)', () => {
  const click = new Float32Array(80); // 5ms
  click.fill(0.9);
  const { samples } = trimSilence(click, SR, { minMs: 120 });
  assert.equal(samples.length, 0);
});

test('mergeGaps : fusionne deux segments proches (< gapMs)', () => {
  const s1 = { samples: makeTone(440, 0.3), startTime: 0, endTime: 0.3 };
  const s2 = { samples: makeTone(440, 0.3), startTime: 0.6, endTime: 0.9 }; // gap 300ms < 600ms
  const s3 = { samples: makeTone(440, 0.3), startTime: 5.0, endTime: 5.3 };  // gap 4.1s
  const merged = mergeGaps([s1, s2, s3], 600, SR);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].samples.length, s1.samples.length + s2.samples.length);
  assert.equal(merged[1].samples.length, s3.samples.length);
});

test('enforceMaxDuration : découpe un segment long', () => {
  const long = makeTone(440, 2.0);
  const chunks = enforceMaxDuration(long, SR, 1000); // max 1s
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((c) => c.length <= SR));
});

test('resampleToRate : 48k → 16k conserve longueur attendue', () => {
  const s48 = new Float32Array(48000);
  for (let i = 0; i < s48.length; i++) s48[i] = Math.sin((2 * Math.PI * 440 * i) / 48000);
  const s16 = resampleToRate(s48, 48000, 16000);
  assert.equal(s16.length, 16000);
  // conservation grossière du contenu fréquentiel : pas de NaN, amplitude bornée
  assert.ok(s16.every((v) => Number.isFinite(v) && Math.abs(v) <= 1.2));
});

test('SegmentPipeline : silence → aucun segment ; parole → 1 segment 16k', () => {
  const pipe = new SegmentPipeline({ sampleRate: SR });
  assert.deepEqual(pipe.process(silence(1.0), SR), []);
  const segs = pipe.process(makeTone(440, 0.5), SR);
  assert.equal(segs.length, 1);
  assert.ok(Math.abs(segs[0].length - 0.5 * SR) < 2 * 0.02 * SR);
});

test('SegmentPipeline : accepte audio 48k (rééchantillonnage interne)', () => {
  const pipe = new SegmentPipeline({ sampleRate: SR });
  const s48 = new Float32Array(24000); // 0.5s @48k
  for (let i = 0; i < s48.length; i++) s48[i] = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 48000);
  const segs = pipe.process(s48, 48000);
  assert.equal(segs.length, 1);
  assert.ok(segs[0].length > 0);
});

// helpers
function concat(arr) {
  const total = arr.reduce((n, a) => n + a.length, 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const a of arr) { out.set(a, o); o += a.length; }
  return out;
}
