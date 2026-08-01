// llm-worker.js — LLM dans un Web Worker dédié (Transformers.js v4.2.0, +esm CDN).
// Streaming token par token via TextStreamer (sous-classé → postMessage), device webgpu/wasm,
// dtype q4f16, prompt système /no_think pour SmolLM3.

import { pipeline, env, TextStreamer, LogLevel } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm';

env.allowLocalModels = false;
env.useBrowserCache = true;   // Cache API (rechargement évité entre visites)
try { env.useWasmCache = true; } catch {}
env.logLevel = LogLevel.WARNING;

// GitHub Pages : pas de COOP/COEP → pas de SharedArrayBuffer → WASM mono-thread forcé.
// (documenté : docs/architecture.md — limitation)
try {
  if (!self.crossOriginIsolated && env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
  }
} catch {}

let generator = null;
let abortCtl = null;

class WorkerStreamer extends TextStreamer {
  constructor(tokenizer, post) {
    super(tokenizer, { skip_prompt: true, skip_special_tokens: true });
    this.post = post;
    this.acc = '';
  }
  write(text) {
    this.acc += text;
    this.post({ type: 'token', text });
  }
  end() {
    super.end?.();
    this.post({ type: 'streamEnd' }); // sans id : événement, pas une réponse de requête
  }
}

const post = (msg) => self.postMessage(msg);

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    switch (type) {
      case 'init': {
        const { model, dtype, device } = payload;
        post({ id, type: 'progress', payload: { stage: 'checking', progress: 0 } });
        const t0 = performance.now();
        generator = await pipeline('text-generation', model, {
          dtype,
          device, // 'webgpu' si dispo, sinon 'wasm' (fallback géré côté main)
          progress_callback: (p) => {
            // p.status: 'initiate' | 'download' | 'progress' | 'progress_total' | 'done'
            if (p.status === 'progress_total') {
              post({ id, type: 'progress', payload: { stage: 'download', progress: p.progress } });
            }
          },
        });
        post({ id, type: 'progress', payload: { stage: 'ready', progress: 1 } });
        post({ id, type: 'ready', payload: { initMs: Math.round(performance.now() - t0) } });
        break;
      }
      case 'generate': {
        const { messages, max_new_tokens, temperature } = payload;
        abortCtl = new AbortController();
        const t0 = performance.now();
        let first = true;
        // Un seul streamer : sous-classe TextStreamer → postMessage par token,
        // wrapper détectant le premier token (latence llm_first_token).
        const streamer = new WorkerStreamer(generator.tokenizer, (m) => {
          if (m.type === 'token') {
            if (first) {
              first = false;
              post({ type: 'firstToken', payload: { ms: Math.round(performance.now() - t0) } });
            }
          }
          post(m);
        });
        const out = await generator(messages, {
          max_new_tokens,
          temperature,
          do_sample: temperature > 0,
          streamer,
          signal: abortCtl.signal,
        });
        const text = out?.[0]?.generated_text?.[out[0].generated_text.length - 1]?.content ?? '';
        post({ id, type: 'done', payload: { text, ms: Math.round(performance.now() - t0) } });
        abortCtl = null;
        break;
      }
      case 'abort': {
        abortCtl?.abort();
        break;
      }
      case 'unload': {
        generator = null;
        break;
      }
    }
  } catch (err) {
    post({ id, type: 'error', payload: { name: err?.name, message: err?.message, stack: err?.stack } });
  }
};
