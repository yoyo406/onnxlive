# ✅ Checklist de vérification

Cocher après déploiement réel (desktop + mobile). Les valeurs de latence sont **à mesurer** — voir `docs/manual-integration-test.md`.

## Environnement
- [ ] Site servi en **HTTPS** (GitHub Pages ou localhost) — micro fonctionnel
- [ ] Pas d'erreur console au chargement (réseau/CDN, workers)
- [ ] Bandeau d'avertissement COOP/COEP absent sur GitHub Pages (WASM mono-thread) affiché et compris

## Premier chargement
- [ ] Les 4 barres de progression (VAD/ASR/LLM/TTS) avancent et passent à « prêt »
- [ ] Taille téléchargement cohérente avec le profil (desktop ≈ 2,35 GB / mobile ≈ 635 MB)
- [ ] Pas de crash OOM pendant le chargement sur mobile (sinon : profil réduit automatique + bandeau)

## Conversation
- [ ] Permission micro demandée à l'appui sur le bouton, refus → message clair, pas de crash (Scénario 3)
- [ ] Parole → transcription affichée (bulle utilisateur)
- [ ] Réponse audio audible (voix FR `ff_siwis`), bulle assistant en streaming
- [ ] Retour automatique à « Écoute » après la réponse
- [ ] Mode texte fonctionne sans micro (Scénario 7)

## Barge-in
- [ ] Parler pendant la lecture → **coupure < 200 ms perçue**, pas de chevauchement
- [ ] Log `BARGE-IN — coupure TTS + annulation LLM/TTS` + métrique `barge_in` renseignée
- [ ] Nouveau tour traité normalement après barge-in

## Dégradation
- [ ] WebGPU désactivé → fallback WASM fonctionnel, bandeau affiché
- [ ] Forçage profil « Mobile WASM » depuis ⚙️ → rechargement avec Qwen-0.5B
- [ ] Échec simulé d'un modèle (réseau coupé au chargement) → bandeau + downgrade, pas de page morte

## Offline
- [ ] Après premier chargement complet : mode avion → rechargement OK, conversation possible
- [ ] Aucun fetch réseau échoué en offline (console)

## Latence (journal — à remplir sur chaque appareil)
| Étape | Desktop (ms) | Mobile (ms) |
|---|---|---|
| VAD trigger → onSpeechStart | | |
| → transcription ASR finale | | |
| → premier token LLM | | |
| → premier chunk audio TTS | | |
| → fin synthèse | | |
| Barge-in → coupure | | |

## Production / déploiement
- [ ] Déployé sur GitHub Pages (`https://<user>.github.io/<repo>/`), sous-dossier OK
- [ ] Workflow Actions optionnel validé (si utilisé)
- [ ] `npm test` : 9/9 verts
- [ ] README à jour ; docs architecture/deployment lues
