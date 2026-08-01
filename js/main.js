// main.js — bootstrap : détection capacité → profil → session → UI.

import { UI } from './ui.js';
import { Session } from './session.js';
import { detectCapabilities, profileOf } from './device.js';
import { SETTINGS_DEFAULTS, PROFILES } from './config.js';
import { log } from './logger.js';

const STORE_KEY = 'smolmlive.settings.v1';

function loadSettings() {
  try { return { ...SETTINGS_DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; }
  catch { return { ...SETTINGS_DEFAULTS }; }
}
function saveSettings(s) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {} }

const ui = new UI();
const settings = loadSettings();

const caps = detectCapabilities();
const profile = profileOf(caps, settings.profile);

const session = new Session({
  caps,
  profile,
  settings,
  ui: {
    onState: (s) => ui.setState(s),
    onProgress: (name, stage, pct) => ui.progress(name, stage, pct),
    onUserText: (t) => ui.addUser(t),
    onUserPartial: (t) => ui.addUserPartial(t),
    onAssistantDelta: (delta, reset) => ui.updateAssistantDelta(delta, reset),
    onAssistantFinal: (t) => ui.finalizeAssistant(t),
    onMetrics: (m) => ui.renderMetrics(m),
    onBanner: (level, msg) => ui.banner(msg, level),
  },
});

ui.init({
  onToggleMic: () => session.toggleMic(),
  onSendText: (t) => session.sendText(t),
  onSettingsChange: (s) => {
    saveSettings(s);
    session.applySettings(s);
    // changement de profil → rechargement complet (modèles différents)
    if (s.profile !== 'auto' && s.profile !== profile && s.profile !== session.profile) {
      ui.banner('Profil changé — rechargement…', 'warn', 3000);
      setTimeout(() => location.reload(), 1200);
    }
  },
});
ui.writeSettings(settings);
ui.setProfileBadge(PROFILES[profile].label);
ui.renderCaps(caps, profile);

log.info('boot', `url=${location.href} caps=${JSON.stringify(caps)} profil=${profile}`);

// avertissements d'environnement (limitations documentées)
if (!caps.isolated) {
  ui.banner(
    'GitHub Pages : pas de COOP/COEP → WASM mono-thread (limitation documentée). ' +
    'Les temps de génération peuvent être élevés.',
    'warn', 12000
  );
}
if (!caps.webgpu) {
  ui.banner('WebGPU absent → backend WASM. Modèle réduit si mobile.', 'warn', 10000);
}

// initialisation des 3 workers (LLM/ASR/TTS) avec progression
session.init()
  .then(() => {
    ui.hideProgress();
    log.info('boot', 'Prêt. Appuie sur le micro.');
  })
  .catch((err) => {
    ui.banner(`Initialisation impossible : ${err.message}`);
    log.error('boot', 'Échec init', err);
  });
