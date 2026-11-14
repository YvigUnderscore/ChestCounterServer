// Shared helpers of the group pages (no framework, no build step). i18n.js gives LANG, LOCALE() and t().
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const loc = () => (typeof LOCALE === 'function' ? LOCALE() : 'fr-FR');
const N = n => n == null ? '—' : Number(n).toLocaleString(loc());

// The view key given in the link (?k=...) is kept by the server in a cookie; pass it on too, for older browsers.
const KEY = new URLSearchParams(location.search).get('k');
function withKey(path) { return path + (KEY ? (path.includes('?') ? '&' : '?') + 'k=' + encodeURIComponent(KEY) : ''); }
async function api(path, options) {
  const r = await fetch(withKey(path), { credentials: 'same-origin', ...options });
  const tr = (key, vars) => (typeof t === 'function' ? t(key, vars) : key);
  if (r.status === 401) throw new Error(tr('errKey'));
  if (!r.ok) throw new Error(r.status === 404 ? tr('errNotFound') : tr('errHttp', { n: String(r.status) }));
  return r.json();
}
