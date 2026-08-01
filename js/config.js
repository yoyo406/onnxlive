// config.js — profils matériel, modèles, prompts. Verrou de la stack (vérifié 2026-08-01).

export const SAMPLE_RATE = 16000;          // 16 kHz mono pour VAD + ASR
export const MAX_NEW_TOKENS = 200;         // réponse vocale courte
export const TEMPERATURE = 0.6;
export const HISTORY_LIMIT = 10;           // messages gardés en contexte (hors system)
export const BARGE_IN_MIN_SPEECH_MS = 200; // seuil barge-in : onSpeechStart suffit (@ricky0123/vad-web), gardé pour logique

// Tailles téléchargement (source : HF API tree, 2026-08-01) — affichage progress.
export const LLM_MODELS = {
  'HuggingFaceTB/SmolLM3-3B-ONNX':      { dtype: 'q4f16', sizeMB: 2124, tier: 'desktop', note: '2.1 GB — desktop uniquement' },
  'onnx-community/Qwen2.5-0.5B-Instruct': { dtype: 'q4f16', sizeMB: 483,  tier: 'mobile',  note: '483 MB — mobile / faible RAM. q4f16 vérifié présent (HF API tree + HTTP 200, 2026-08-01) ; alternatives si 404 : q4 (786 MB) / fp16 (997 MB)' },
  'onnx-community/Qwen2.5-1.5B-Instruct': { dtype: 'q4f16', sizeMB: 1222, tier: 'desktop', note: '1.2 GB — intermédiaire' },
};

// Système : SmolLM3 supporte /no_think (chat template officiel) pour limiter la latence.
export function buildSystemPrompt(modelId, language) {
  const lang = language || 'fr';
  const base =
    'You are a voice assistant running locally in the browser. ' +
    `Answer in ${lang}. Be brief and conversational (max 3 sentences). ` +
    'Do not use markdown, lists or code. Speak like you talk.';
  // /no_think doit être présent dans le message système (voir README HuggingFaceTB/SmolLM3-3B-ONNX)
  return modelId.includes('SmolLM3') ? `/no_think\n${base}` : base;
}

export const PROFILES = {
  'desktop-webgpu': {
    label: 'Desktop WebGPU',
    llm:  { model: 'HuggingFaceTB/SmolLM3-3B-ONNX', dtype: 'q4f16', device: 'webgpu' },
    asr:  { model: 'whisper-base', device: 'auto' },  // browser-whisper choisit webgpu/wasm
    tts:  { dtype: 'q8', device: 'wasm' },
  },
  'desktop-wasm': {
    label: 'Desktop WASM mono-thread',
    llm:  { model: 'HuggingFaceTB/SmolLM3-3B-ONNX', dtype: 'q4f16', device: 'wasm' }, // RAM ≥ 6 GB recommandée
    asr:  { model: 'whisper-base', device: 'auto' },
    tts:  { dtype: 'q8', device: 'wasm' },
  },
  'mobile-webgpu': {
    label: 'Mobile WebGPU',
    llm:  { model: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4f16', device: 'webgpu' },
    asr:  { model: 'whisper-tiny', device: 'auto' },
    tts:  { dtype: 'q8', device: 'wasm' },
  },
  'mobile-wasm': {
    label: 'Mobile WASM',
    llm:  { model: 'onnx-community/Qwen2.5-0.5B-Instruct', dtype: 'q4f16', device: 'wasm' },
    asr:  { model: 'whisper-tiny', device: 'auto' },
    tts:  { dtype: 'q8', device: 'wasm' },
  },
};

export const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const TTS_VOICE_DEFAULT = 'ff_siwis';   // voix FR (Kokoro)
export const TTS_SIZE_MB = { q8: 86, fp32: 163 };

export const ASR_SIZE_MB = { 'whisper-tiny': 64, 'whisper-base': 136, 'distil-whisper-small': 185 }; // README browser-whisper

// CDN versions verrouillées (vérifiées 2026-08-01)
export const CDN = {
  transformers: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0/+esm',
  browserWhisper: 'https://cdn.jsdelivr.net/npm/browser-whisper@1.1.0/+esm',
  kokoro: 'https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/+esm',
  vadWeb: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/+esm',
};

export const SETTINGS_DEFAULTS = {
  profile: 'auto',
  language: 'fr',
  voice: TTS_VOICE_DEFAULT,
  ttsMode: 'q8-wasm',
  partial: true,
  maxTokens: MAX_NEW_TOKENS,
};
