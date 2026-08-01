# 🗣️ OnnxLive

Assistant vocal conversationnel **100 % local, 100 % navigateur** — architecture type GPT-Live / Gemini Live,
sans backend, hébergeable sur **GitHub Pages** (statique), desktop **et** mobile.

📦 Repo : <https://github.com/yoyo406/onnxlive> · 🌐 Live (une fois Pages activé) : <https://yoyo406.github.io/onnxlive/>

```
parole → VAD (Silero) → ASR (Whisper) → LLM (SmolLM3-3B, streaming) → TTS (Kokoro-82M, streaming) → audio
                                                        ↑ barge-in à tout moment
```

## Fonctionnalités
- 🎙️ Pipeline entièrement **streaming** : tokens LLM → synthèse TTS par phrase, aucune attente de réponse complète
- 🔇 **Barge-in** : parle pendant que l'assistant parle → coupure immédiate + annulation LLM/TTS
- 📊 Latence mesurée à chaque étape (panneau debug 🐞) : VAD → ASR → premier token → premier audio
- 📱 UI mobile-first (gros bouton micro, états : Écoute / Traite / Parle), mode texte de secours
- 💾 Cache persistant (Cache API + OPFS) → **offline après premier chargement**
- 🧩 Composants remplaçables (profils dans `js/config.js`), dégradation gracieuse (WebGPU absent, mémoire faible)

## Stack (vérifiée le 2026-08-01)

| Composant | Librairie | Modèle | Taille DL |
|---|---|---|---|
| LLM | Transformers.js **4.2.0** | `HuggingFaceTB/SmolLM3-3B-ONNX` q4f16 (desktop) | 2,1 GB |
| LLM mobile | idem | `onnx-community/Qwen2.5-0.5B-Instruct` q4f16 | 483 MB |
| ASR | browser-whisper **1.1.0** (encodeur fp32 + décodeur q4) | whisper-base (desktop) / whisper-tiny (mobile) | 136 / 64 MB |
| VAD | @ricky0123/vad-web **0.0.30** (MicVAD, Silero, AudioWorklet) | silero_vad (legacy) | ~1,8 MB |
| TTS | kokoro-js **1.2.1** (TextSplitterStream + `stream(splitter, {voice})`) | `Kokoro-82M-v1.0-ONNX` dtype `q8`, voix FR `ff_siwis` | 86 MB |

> ⚠️ **SmolLM3-3B n'est pas viable sur mobile** (2,1 GB + RAM onglet limitée) : le profil mobile bascule
> automatiquement sur Qwen2.5-0.5B. Détails et sources : [`docs/architecture.md`](docs/architecture.md).
>
> ✅ **Qwen2.5-0.5B-Instruct q4f16 vérifié** (2026-08-01) : fichier `onnx/model_q4f16.onnx` (483 MB)
> présent dans le repo HF (API tree + HTTP 200). Alternatifs si un dtype renvoyait 404 : `q4` (786 MB),
> `fp16` (997 MB) — tous présents.

## Prérequis navigateur / matériel

| Profil | Navigateur | RAM conseillée | WebGPU requis |
|---|---|---|---|
| Desktop WebGPU | Chrome/Edge ≥ 113, Firefox ≥ 141, Safari ≥ 18 | ≥ 8 GB | oui (sinon fallback WASM) |
| Desktop WASM | idem | ≥ 6 GB | non |
| Mobile (Android Chrome / iOS Safari ≥ 18) | navigateur récent | ≥ 3 GB | optionnel (fallback WASM) |

- **Micro** : contexte sécurisé (HTTPS — GitHub Pages natif, ou `http://localhost`), permission explicite.
- **GitHub Pages** : pas de COOP/COEP → WASM mono-thread (limitation assumée, fallback fonctionnel).

## Démarrage rapide

```bash
npm test          # tests unitaires (segmentation VAD, node:test)
npx serve -l 8080 .   # servir localement (HTTP requis : workers + import maps)
# → http://localhost:8080  — appuie sur le micro, parle.
```

Premier chargement : téléchargement des modèles avec progression (desktop ≈ 2,35 GB, mobile ≈ 635 MB).
Visites suivantes : instantané (cache), même **offline**.

## Déploiement GitHub Pages

1. ✅ Repo créé et poussé : `https://github.com/yoyo406/onnxlive` (branch `main`).
2. Activer Pages — **Settings → Pages → Deploy from branch** `main` `/root`, ou :
   ```bash
   gh api repos/yoyo406/onnxlive/pages -X POST -f build_type=workflow   # workflow fourni
   ```
3. Une fois activé : `https://yoyo406.github.io/onnxlive/` (tous les chemins sont relatifs → project page OK).

Pas à pas complet + alternatives multi-thread (Netlify/Vercel + COOP/COEP) : [`docs/deployment.md`](docs/deployment.md).

## Documentation

| Fichier | Contenu |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | Diagrammes (mermaid), tableau des choix sourcés, tailles/RAM, risques |
| [`docs/deployment.md`](docs/deployment.md) | Déploiement GitHub Pages pas à pas + limitations |
| [`docs/manual-integration-test.md`](docs/manual-integration-test.md) | Protocole de test manuel + journal de mesures |
| [`CHECKLIST.md`](CHECKLIST.md) | Checklist de vérification |
| [`tests/`](tests/) | Tests unitaires (`npm test`) |

## Statut

- ✅ Code audité et corrigé (2026-08-01) — catégories 1 à 5 : worker LLM, VAD MicVAD réel, voix TTS, échelle de downgrade, docs
- ✅ Tests unitaires : **9/9** (`npm test`), syntaxe validée sur tous les fichiers
- 🚧 GitHub Pages : à activer (voir ci-dessus) — après activation, l'URL live fonctionne directement

## Limites connues (honnêtes)
- **Performance** : aucun benchmark ne peut être garanti — tout dépend de l'appareil ; mesurer avec le panneau debug (⚠️ WASM mono-thread sur GitHub Pages).
- **SmolLM3-3B** : desktop seulement (RAM/buffer WebGPU) — fallback Qwen-0.5B automatique.
- **Premier chargement long** : 2,35 GB desktop avant mise en cache.
- **Interruption de génération LLM** : dépend du support de `signal` par le runtime (vérifié sur l'appareil cible).
