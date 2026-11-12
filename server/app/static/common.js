// Shared helpers of the group pages (no framework, no build step).
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const N = n => n == null ? '—' : Number(n).toLocaleString('fr-FR');

// The view key given in the link (?k=...) is kept by the server in a cookie; pass it on too, for older browsers.
const KEY = new URLSearchParams(location.search).get('k');
function withKey(path) { return path + (KEY ? (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(KEY) : ''); }
async function api(path, options) {
  const r = await fetch(withKey(path), { credentials: 'same-origin', ...options });
  if (r.status === 401) throw new Error('Lien incomplet : il manque la clé de lecture du groupe (?k=...). Demande le lien complet à celui qui héberge le serveur.');
  if (!r.ok) throw new Error(r.status === 404 ? 'Introuvable.' : 'Erreur ' + r.status);
  return r.json();
}
