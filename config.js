/**
 * Deployment config (edit before pushing to GitHub Pages if needed).
 *
 * backend:
 *   "auto" — Firebase on *.github.io, file://, or if socket.io fails to load;
 *            Socket.io when opened from localhost / LAN with npm start.
 *   "firebase" — always use Firebase Realtime Database (works on GitHub Pages).
 *   "socket" — always use Socket.io (set socketUrl if not same-origin).
 *
 * socketUrl: e.g. "https://your-app.onrender.com" when hosting server.js elsewhere.
 * giphyApiKey: optional; browser calls Giphy directly when set (for static hosting).
 */
window.APP_CONFIG = {
  backend: "firebase",
  giphyApiKey: "GYRCvyFxAWSOquEOXiJFMtY7YS2VDpOL",
};