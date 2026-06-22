# Leçons locales — vscode-acp-perso

Les leçons HTML chargent CSS et JavaScript (`assets/styles.css`, `assets/quiz.js`). **Ne les ouvre pas en double-cliquant le fichier** (`file://…`) : Chrome et les navigateurs embarqués (Simple Browser, Live Preview) bloquent ces ressources (`net::ERR_ACCESS_DENIED`).

Serve le dossier `learning/` en HTTP local, puis ouvre les pages ci-dessous.

## Lancer le serveur

Depuis la racine du dépôt :

```bash
npm run learning:serve
```

Ou directement :

```bash
npx --yes serve learning
```

Le terminal affiche l’URL de base (souvent `http://localhost:3000`).

**Alternative sans Node :**

```bash
cd learning
python3 -m http.server 8080
```

Base : `http://localhost:8080`

## Pages à ouvrir

| Contenu | URL (avec `serve learning` sur le port 3000) |
|--------|-----------------------------------------------|
| **Leçon 1 — Vue d’ensemble** | http://localhost:3000/lessons/0001-vue-ensemble-architecture.html |
| Glossaire ACP client | http://localhost:3000/reference/glossaire-acp-client.html |
| Mission (Markdown) | http://localhost:3000/MISSION.md |
| Ressources | http://localhost:3000/RESOURCES.md |

Adapte le port si ton terminal en indique un autre (ex. `8080` avec Python).

**Point d’entrée recommandé :** [Leçon 1](http://localhost:3000/lessons/0001-vue-ensemble-architecture.html) — ~8 minutes, quiz interactif en bas de page.

## Vérifier que tout charge

1. Le style est appliqué (fond sombre, typo lisible).
2. Le quiz en bas répond au clic (boutons vert/rouge, message de feedback).

Si le quiz ne réagit pas, ouvre les outils développeur (F12) : une erreur `ERR_ACCESS_DENIED` sur `quiz.js` signifie que la page est encore servie en `file://` — relance le serveur et utilise l’URL `http://localhost:…`.

## Arrêter le serveur

Dans le terminal où il tourne : `Ctrl+C`.
