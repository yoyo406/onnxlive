# 🧪 Test d'intégration manuel

Les tests automatisés en environnement navigateur pur sont limités (micro, WebGPU,
workers, audio) → **protocole manuel documenté**, à exécuter sur chaque appareil cible.
Tests unitaires automatisés : `npm test` (logique de segmentation VAD, node:test — 9 tests).

## Préparation
1. Déployer sur GitHub Pages (ou `npx serve -l 8080` en local, HTTPS requis pour le micro).
2. Chrome/Edge ≥ 113 (WebGPU), Firefox ≥ 141, Safari ≥ 18, ou navigateur mobile Android/iOS récent.
3. Ouvrir le panneau debug (🐞) : latences + logs en direct.
4. Ouvrir la console DevTools : logs structurés `[HH:MM:SS.mmm] [tag] message`.

## Scénario 1 — parcours nominal (desktop)
| # | Action | Attendu |
|---|---|---|
| 1 | Charger la page | « Démarrage » → barres progression LLM/ASR/TTS/VAD → « Prêt » |
| 2 | Appuyer sur le micro | Permission micro demandée → « Écoute… » (pulsation bleue) |
| 3 | « Quelle est la capitale de la France ? » | VAD → ASR (texte utilisateur affiché) → « Traite… » → « Parle… » |
| 4 | Écouter la réponse | Audio TTS (voix ff_siwis FR) ; bulle assistant se remplit en streaming |
| 5 | Attendre la fin | Retour « Écoute… » automatique |
| 6 | Relire les latences | Panneau debug : `vad_trigger`, `asr_final`, `llm_first_token`, `tts_first_chunk`, `tts_end` — **noter les valeurs sur l'appareil** |

**Critère de succès** : réponse complète et audible, < 10 s premier tour sur desktop WebGPU (à mesurer — pas de valeur garantie).

## Scénario 2 — barge-in (fonctionnel ?)
| # | Action | Attendu |
|---|---|---|
| 1 | Déclencher une réponse longue (« Raconte une histoire courte ») | « Parle… » |
| 2 | **Pendant la lecture**, dire « Stop ! » | Lecture coupée immédiatement, LLM/TTS abortés, retour « Écoute… », nouvelle transcription « stop » traitée |
| 3 | Vérifier logs | `BARGE-IN — coupure TTS + annulation LLM/TTS` ; métrique `barge_in` renseignée |

**Critère** : coupure < 200 ms perçue ; pas de chevauchement entre voix TTS et tour utilisateur.

## Scénario 3 — refus de permission micro
| # | Action | Attendu |
|---|---|---|
| 1 | Bloquer la permission micro (paramètres site) | Appui micro → bandeau rouge « Permission micro refusée… » ; pas de crash ; app continue |
| 2 | Ré-autoriser puis réessayer | Fonctionne |

## Scénario 4 — WebGPU absent / dégradation
| # | Action | Attendu |
|---|---|---|
| 1 | Désactiver WebGPU (chrome://flags, ou Firefox sans flag) | Bandeau « WebGPU absent → WASM » ; profil bascule automatiquement |
| 2 | Recharger | App fonctionne (lent sur desktop-wasm) |
| 3 | DevTools → Performance → forcer throttling CPU 4× | Simule mobile : vérifier qu'aucune erreur OOM |

## Scénario 5 — mobile réel
| # | Action | Attendu |
|---|---|---|
| 1 | Ouvrir sur smartphone Android (Chrome) | Profil « Mobile WebGPU » ou « Mobile WASM » ; UI adaptée (gros bouton) |
| 2 | Parler (FR) | Pipeline complet, latences notées dans le panneau debug |
| 3 | Test de mémoire | Onglet en arrière-plan 5 min puis retour : pas de crash (OOM) ; recharger si nécessaire |
| 4 | iPhone (Safari ≥ 18) | WebGPU absent sur certains modèles → fallback WASM + profil mobile |

## Scénario 6 — offline après premier chargement
| # | Action | Attendu |
|---|---|---|
| 1 | Charger une fois en ligne (tous modèles « prêt ») | — |
| 2 | Mode avion / couper le réseau | Recharger : l'app démarre sans réseau (modèles en Cache API/OPFS), conversation possible |
| 3 | Vérifier console | Pas d'erreur de fetch sur huggingface.co/jsdelivr |

## Scénario 7 — mode texte (sans micro)
| # | Action | Attendu |
|---|---|---|
| 1 | Taper un message dans le champ texte, Entrée | Réponse complète (LLM + TTS) sans passer par le micro |

## Scénario 8 — réglages
| # | Action | Attendu |
|---|---|---|
| 1 | ⚙️ → changer voix (ex. af_heart) | Prochaine réponse avec la nouvelle voix |
| 2 | ⚙️ → TTS fp32/webgpu | Rechargement TTS, meilleure qualité (desktop) |
| 3 | ⚙️ → forcer profil « Mobile WASM » | Bandeau + rechargement ; LLM Qwen-0.5B |

## Journal de mesure (à remplir)
| Appareil / navigateur | WebGPU | vad_trigger | asr_final | llm_first_token | tts_first_chunk | tts_end | barge-in | offline OK | remarques |
|---|---|---|---|---|---|---|---|---|---|
| ex. Desktop Chrome 138 / RTX | oui | 250 ms | 900 ms | 1,2 s | 2,0 s | 4,5 s | oui | oui | — |
| ex. Android Pixel 8 Chrome | non (WASM) | 300 ms | 1,4 s | 4 s | 6 s | 12 s | oui | oui | 3B impossible, Qwen 0.5B OK |

> Toute valeur hors de ce tableau est à considérer comme « à mesurer localement » — aucun benchmark n'est fourni comme garantie (voir architecture.md §4).
