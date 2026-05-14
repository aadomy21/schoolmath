# schoolmath

I built this for our school community. Since the school Wi-Fi blocks Discord and other messaging apps, this bypasses those restrictions so we can chat when we bored or another classes.

## School portal (Discord-style chat)

This repo is **static HTML/CSS/JS**. On **GitHub Pages** there is no Node server, so the app uses **Firebase Realtime Database** for chat, presence, typing, and reactions (same Firebase project as auth).

1. Push these files to GitHub (root of the repo): `index.html`, `style.css`, `app.js`, `config.js`, `.nojekyll`. You do **not** need `node_modules/` or `server.js` for Pages (they are ignored by `.gitignore` for `node_modules`).
2. In the repo: **Settings → Pages → Build and deployment → Source**: Deploy from branch **main** (or **master**), folder **/** (root).
3. Open `https://<user>.github.io/<repo>/` — login should work if Firebase Auth allows your domain (add the GitHub Pages URL under **Authentication → Settings → Authorized domains** in Firebase).

Optional: set a [Giphy](https://developers.giphy.com/) API key in `config.js` as `giphyApiKey` so GIF search works without a backend.

## Local dev with Socket.io (guilds, invites, RBAC)

From the project folder:

```bash
npm install
npm start
```

Then open `http://localhost:3000`. In **auto** mode, localhost uses the Node/Socket.io server; set `backend: "socket"` in `config.js` to force it.

To use Socket.io from GitHub Pages, deploy `server.js` (e.g. Render, Fly.io) and set `socketUrl` in `config.js` to that origin.
