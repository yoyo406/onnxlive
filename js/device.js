// device.js — détection de capacité + sélection de profil (dégradation gracieuse).

import { PROFILES } from './config.js';

export function detectCapabilities() {
  const ua = navigator.userAgent || '';
  const isMobile =
    /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (navigator.maxTouchPoints > 0 && window.matchMedia?.('(pointer: coarse)').matches);

  // WebGPU : présent si navigator.gpu existe. (Fiabilité variable — voir docs/architecture.md)
  let webgpu = !!navigator.gpu;
  if (webgpu) {
    try {
      // Détection synchrone possible : l'objet existe. La vérification réelle se fait
      // au chargement du modèle (requestAdapter peut échouer).
    } catch { webgpu = false; }
  }

  // Mémoire : navigator.deviceMemory = Chrome/Edge uniquement (Googolbytes).
  const deviceMemory = navigator.deviceMemory || (isMobile ? 2 : 4);
  const cores = navigator.hardwareConcurrency || (isMobile ? 4 : 8);

  return {
    isMobile,
    webgpu,
    isolated: !!crossOriginIsolated,      // false sur GitHub Pages → WASM mono-thread
    deviceMemory,
    cores,
    ua: ua.slice(0, 120),
  };
}

export function pickProfile(caps) {
  if (caps.webgpu) return caps.isMobile ? 'mobile-webgpu' : 'desktop-webgpu';
  return caps.isMobile ? 'mobile-wasm' : 'desktop-wasm';
}

// Échelle de secours quand un modèle échoue (OOM / WebGPU KO).
// Principe (audit 2026-08-01) : réduire la TAILLE du modèle en conservant le device
// (wasm→wasm, webgpu→webgpu), SAUF si l'échec est explicitement une erreur WebGPU
// (dans ce cas uniquement : bascule vers wasm sur le même tier desktop/mobile).
// desktop = gros modèle (SmolLM3-3B), mobile = petit modèle (Qwen2.5-0.5B).
export function downgradeProfile(current, reason = '') {
  const webgpuError = /webgpu/i.test(reason || '');
  switch (current) {
    case 'desktop-webgpu': return webgpuError ? 'desktop-wasm' : 'mobile-webgpu';
    case 'desktop-wasm':   return 'mobile-wasm';   // wasm reste wasm, modèle plus petit
    case 'mobile-webgpu':  return webgpuError ? 'mobile-wasm' : null;
    case 'mobile-wasm':    return null;            // dernier échelon
    default:               return null;
  }
}

export function profileOf(caps, override) {
  if (override && override !== 'auto' && PROFILES[override]) return override;
  return pickProfile(caps);
}
