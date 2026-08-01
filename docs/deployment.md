# 🚀 Déploiement GitHub Pages pas à pas

## Prérequis
- Repo GitHub (public ou privé) — Pages gratuites.
- Le projet est **100 % statique, sans build** : pas de bundler, pas de serveur.
- Déploiement en **project page** (`https://<user>.github.io/<repo>/`) — tous les chemins sont relatifs, aucune config base.

## Étape 1 — pousser le code

```bash
cd smolmlive
git init
git add .
git commit -m "SmolMLive : assistant vocal 100% navigateur"
git branch -M main
git remote add origin git@github.com:<user>/smolmlive.git
git push -u origin main
```

## Étape 2 — activer GitHub Pages (2 options)

### Option A — manuelle (recommandée, zéro CI)
1. Repo → **Settings → Pages**.
2. Source : **Deploy from a branch** → `main` / `/ (root)` → **Save**.
3. URL : `https://<user>.github.io/smolmlive/`.

### Option B — GitHub Actions (fournie)
Le workflow `.github/workflows/deploy.yml` (fourni) publie sur Pages à chaque push :
1. **Settings → Pages** → Source : **GitHub Actions**.
2. Push suivant → l'action `pages-build-deployment` livre le site.
3. En `gh` CLI :
```bash
gh repo create <user>/smolmlive --public --source=. --push
```

## Étape 3 — vérifier
1. Ouvre l'URL. L'écran doit afficher « Démarrage » puis « Chargement… » avec les barres de progression des 4 modèles.
2. **HTTPS** : GitHub Pages sert HTTPS natif → `navigator.mediaDevices.getUserMedia` et Cache API/OPFS disponibles. Le micro ne fonctionnera PAS en `http://localhost` sans certificat (voir Étape 4).
3. **Cohérence des chemins** : l'app est en `/smolmlive/` — les workers (`new Worker(new URL(...))`) et le CSS/JS relatifs fonctionnent sans config.

## Étape 4 — test en local (avant push)
Workers + import maps exigent HTTP(S) (pas `file://`) :

```bash
cd smolmlive
npx serve -l 8080 .     # ou : python3 -m http.server 8080
# → http://localhost:8080  (micro : Chrome accepte localhost comme contexte sûr)
```

⚠️ **Micro sur autre hôte local** : `navigator.mediaDevices` exige un contexte sécurisé.
`http://localhost` OK ; pour une IP LAN : `openssl` + serveur HTTPS, ou `npx serve --ssl`.

## Limitation connue (à lire)
- **Pas de COOP/COEP** sur GitHub Pages → WASM mono-thread (documenté dans `architecture.md` §3.2).
  → Performances LLM réduites sur les gros modèles. Si tu veux du multi-thread :
  - **Netlify** : fichier `_headers` → `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Opener-Policy: same-origin` (déploiement identique, drag & drop du dossier).
  - **Vercel** : `vercel.json` headers equivalents.
  - ⚠️ Avec COEP activé, les ressources CDN (wasm, worklets) doivent être CORP/CORS-compatibles (jsdelivr l'est) — à tester.

## Cache & offline
- Première visite : téléchargement des modèles (progression affichée). Desktop ≈ 2,35 GB, mobile ≈ 635 MB.
- Visites suivantes : **Cache API** (Transformers.js, kokoro) + **OPFS** (browser-whisper) → chargement quasi instantané, **fonctionne offline** (après premier chargement complet).
- Pour forcer une mise à jour de modèle : vider le cache site (DevTools → Application → Cache Storage / Storage) ou `BrowserWhisper.clearCache()` (console).

## Dépannage
| Symptôme | Cause probable | Correctif |
|---|---|---|
| Barre LLM bloquée à « vérif cache » | Cache API saturée / quota | Vider le cache navigateur, réessayer |
| « Appareil insuffisant » | OOM pendant chargement modèle | Choisir un profil plus léger (réglages ⚙️) |
| Pas de son | Autoplay policy | Appuyer sur le micro (geste utilisateur) avant tout |
| Micro grisé | Contexte non sécurisé | Être sur HTTPS (GH Pages) ou localhost |
| WASM lent | Mono-thread (GH Pages) | Profil réduit, ou Netlify/Vercel avec COOP/COEP |
