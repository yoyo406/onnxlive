// tts-worker.js — TTS Kokoro-82M dans un Web Worker (kokoro-js 1.2.1).
// Streaming : TextSplitterStream + tts.stream() → audio par phrase au fil du texte LLM.
// Device 'wasm' + dtype 'q8' par défaut (86 MB) ; 'webgpu' + 'fp32' optionnel (qualité).

import { KokoroTTS, TextSplitterStream } from 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm';

let tts = null;
let splitter = null;
let streamTask = null;
let aborted = false;

const post = (msg) => self.postMessage(msg, msg.transfer || []);

// Un "tour" TTS = 1 stream ouvert. Le main pousse les tokens LLM, puis flush/close.
// La voix se passe à tts.stream(splitter, { voice }) — vérifié dans le bundle +esm v1.2.1 :
//   stream(e, {voice="af_heart", speed=1, split_pattern=null} = {})
//   from_pretrained(e, {dtype="fp32", device=null, progress_callback=null})  ← PAS de voice ici.
async function runStream(voice) {
  aborted = false;
  splitter = new TextSplitterStream();
  const stream = tts.stream(splitter, { voice });
  streamTask = (async () => {
    for await (const chunk of stream) {
      if (aborted) break;
      const audio = chunk.audio;
      // Float32Array mono ; sampleRate Kokoro = 24000 Hz (le player rééchantillonne)
      post({
        type: 'audio',
        transfer: [audio.buffer],
        payload: { audio, text: chunk.text, phonemes: chunk.phonemes },
      });
    }
    post({ type: 'streamEnd' });
  })();
}

self.onmessage = async (e) => {
  const { id, type, payload } = e.data || {};
  try {
    switch (type) {
      case 'init': {
        const { modelId, dtype, device } = payload;
        post({ id, type: 'progress', payload: { stage: 'checking', progress: 0 } });
        tts = await KokoroTTS.from_pretrained(modelId, {
          dtype,          // 'q8' | 'fp32' | 'fp16' | 'q4' | 'q4f16'
          device,         // 'wasm' | 'webgpu'
          // NB : la voix n'est PAS une option de from_pretrained (signature vérifiée) —
          // elle se passe à tts.stream(splitter, { voice }) à chaque tour (case 'open').
          progress_callback: (p) => {
            if (p.status === 'progress_total') {
              post({ id, type: 'progress', payload: { stage: 'download', progress: p.progress } });
            }
          },
        });
        post({ id, type: 'progress', payload: { stage: 'ready', progress: 1 } });
        post({ id, type: 'ready' });
        break;
      }
      case 'open': {
        // nouveau tour : ouvre le stream (après init ou après abort)
        runStream(payload.voice || 'ff_siwis');
        post({ id, type: 'ready' });
        break;
      }
      case 'text': {
        splitter?.push(payload.text);
        break;
      }
      case 'flush': {
        splitter?.flush();
        break;
      }
      case 'close': {
        splitter?.close();
        break;
      }
      case 'abort': {
        aborted = true;
        try { splitter?.close(); } catch {}
        break;
      }
      case 'unload': {
        aborted = true;
        try { splitter?.close(); } catch {}
        tts = null;
        break;
      }
    }
  } catch (err) {
    post({ id, type: 'error', payload: { name: err?.name, message: err?.message, stack: err?.stack } });
  }
};
