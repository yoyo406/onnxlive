// vad-manager.js — wrapper @ricky0123/vad-web (MicVAD, Silero VAD).
// API vérifiée 2026-08-01 depuis les types publiés (dist/real-time-vad.d.ts) et le bundle
// +esm v0.0.30 (npm registry : latest = 0.0.30, deps onnxruntime-web ^1.17.0 → résolu 1.23.2) :
//   MicVAD.new({ model, baseAssetPath, onnxWASMBasePath, startOnLoad, getStream,
//                onSpeechStart, onSpeechRealStart, onVADMisfire, onFrameProcessed, onSpeechEnd })
//     → Promise<MicVAD>  puis  vad.start() / vad.pause() / vad.destroy()
//   onSpeechEnd(audio) : Float32Array mono, sampleRate 16000 (documenté dans les types).
//
// Chemins requis (fichiers .onnx + worklet + wasm ORT servis depuis un CDN statique) :
//   baseAssetPath    → dist du paquet (silero_vad_legacy.onnx 1,8 MB + vad.worklet.bundle.min.js)
//   onnxWASMBasePath → dist onnxruntime-web@1.23.2 (version embarquée dans le bundle +esm v0.0.30)
// Alternative GitHub Pages : committer ces fichiers dans le repo et pointer les chemins en relatif.

import { MicVAD } from '@ricky0123/vad-web';
import { SegmentPipeline, resampleToRate } from './vad-segmenter.js';
import { SAMPLE_RATE } from './config.js';
import { log } from './logger.js';

const VAD_BASE_ASSET_PATH = 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/';
const VAD_ONNX_WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

export class VadManager {
  /**
   * @param {object} opts
   * @param {()=>void} opts.onSpeechStart      // début parole (barge-in si TTS en cours)
   * @param {(seg:{audio:Float32Array,startTime:number,endTime:number})=>void} opts.onOngoing  // partiel ~1 s
   * @param {(seg:{audio:Float32Array,startTime:number,endTime:number})=>void} opts.onSegment  // segment final 16 kHz
   * @param {(stage:string,pct:number)=>void} opts.onProgress  // 'checking'|'ready' (modèle VAD ~2 MB, pas de progression fine)
   */
  constructor(opts = {}) {
    this.opts = opts;
    this.pipeline = new SegmentPipeline({ sampleRate: SAMPLE_RATE });
    this.vad = null;
    this.running = false;
    this.speechActive = false;
    this.partial = new Float32Array(0);
    this.segStart = 0;
  }

  async start() {
    if (this.running) return;
    this.opts.onProgress?.('checking', 0);
    const t0 = performance.now();
    try {
      const vad = await MicVAD.new({
        model: 'legacy',                 // silero_vad_legacy.onnx (défaut upstream, 1,8 MB)
        baseAssetPath: VAD_BASE_ASSET_PATH,
        onnxWASMBasePath: VAD_ONNX_WASM_BASE_PATH,
        startOnLoad: false,              // démarrage explicite après init
        // getStream : défaut de la lib = getUserMedia({audio:{channelCount:1}}) → permission micro
        onSpeechStart: () => {
          log.info('vad', `onSpeechStart (+${Math.round(performance.now() - t0)}ms)`);
          this.opts.onSpeechStart?.();
        },
        onSpeechRealStart: () => {
          // parole validée (n'est pas un misfire) → ouverture du segment partiel
          this.speechActive = true;
          this.partial = new Float32Array(0);
          this.segStart = performance.now();
        },
        onVADMisfire: () => { log.debug('vad', 'onVADMisfire'); },
        onFrameProcessed: (_probs, frame) => {
          // accumulation frame par frame (32 ms @16 kHz) → onOngoing (~1 s)
          if (!this.speechActive) return;
          this._accumulate(frame);
        },
        onSpeechEnd: (audio) => {
          this.speechActive = false;
          this.partial = new Float32Array(0);
          // audio est déjà 16 kHz (types) — garde défensive si la lib change
          const at16k = resampleToRate(audio, SAMPLE_RATE, SAMPLE_RATE);
          const segments = this.pipeline.process(at16k, SAMPLE_RATE);
          const durMs = (audio.length / SAMPLE_RATE) * 1000;
          log.debug('vad', `onSpeechEnd : ${durMs.toFixed(0)}ms → ${segments.length} segment(s)`);
          for (const s of segments) {
            this.opts.onSegment?.({
              audio: s,
              startTime: this.segStart / 1000,
              endTime: performance.now() / 1000,
            });
          }
        },
      });
      await vad.start();
      this.vad = vad;
      this.running = true;
      this.opts.onProgress?.('ready', 1);
      log.info('vad', 'VAD démarré (MicVAD, Silero legacy, AudioWorklet)');
    } catch (err) {
      log.error('vad', 'Échec démarrage VAD', err);
      throw err;
    }
  }

  _accumulate(frame) {
    const next = new Float32Array(this.partial.length + frame.length);
    next.set(this.partial, 0);
    next.set(frame, this.partial.length);
    if (next.length >= SAMPLE_RATE) { // ~1 s accumulée → émission partielle
      this.opts.onOngoing?.({
        audio: next.slice(),
        startTime: this.segStart / 1000,
        endTime: performance.now() / 1000,
      });
      this.partial = new Float32Array(0);
    } else {
      this.partial = next;
    }
  }

  async stop() {
    if (this.vad) {
      try { await this.vad.destroy(); } catch (err) { log.warn('vad', 'destroy()', err); }
      this.vad = null;
    }
    this.running = false;
    this.speechActive = false;
    log.info('vad', 'VAD arrêté');
  }
}
