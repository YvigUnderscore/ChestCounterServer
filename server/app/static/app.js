// The group site: one page, tabs drawn from the address (/, /p/<id>, /p/<id>/chances, /p/<id>/collection,
// /parties, /g/<match>, /aide), like the tabs of the ChestCounter window.
const PALETTE = ['#c9a24f', '#1f7f7a', '#6c3fb5', '#a3361f', '#3a6ea5', '#7a8b2e', '#b5567d', '#4f7f3a'];
const cache = {};
let ME = null;
try { ME = localStorage.getItem('cc-me'); } catch (e) { /* private mode */ }

// --- formatting -------------------------------------------------------------------------------------------------

function when(iso, withYear) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}) }) + ' ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function pct(p) {
  const v = p * 100;
  if (v >= 10) return v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' %';
  if (v >= 0.1) return v.toLocaleString('fr-FR', { maximumFractionDigits: 2 }) + ' %';
  if (v === 0) return '0 %';
  return v.toLocaleString('fr-FR', { maximumSignificantDigits: 2 }) + ' %';
}
const PLAYLISTS = [[/nobuild|zb|zerobuild/i, 'Zéro construction'], [/squad/i, 'Section'], [/trio/i, 'Trio'], [/duo/i, 'Duo'], [/solo/i, 'Solo']];
function mode(p) {
  if (!p) return '—';
  const parts = PLAYLISTS.filter(([re]) => re.test(p)).map(([, n]) => n);
  return parts.length ? [...new Set(parts)].join(' · ') : p.replace(/^Playlist_/, '');
}
function place(t) {
  if (t.placement == null) return '—';
  return t.placement === 1 ? '<b class="win">Top 1</b>' : '#' + t.placement + (t.totalPlayers ? '<span class="mut">/' + t.totalPlayers + '</span>' : '');
}
function playerLink(id, name) { return id ? `<a href="/p/${encodeURIComponent(id)}">${esc(name)}</a>` : `<span class="mut">${esc(name)}</span>`; }
function tile(value, label, cls = '') { return `<div class="tile ${cls}"><div class="v num">${value}</div><div class="l">${label}</div></div>`; }
function section(title, body, extra = '') { return `<section><div class="sh"><h2 class="pirate">${title}</h2>${extra}</div>${body}</section>`; }

// Status of a team in a match: every human teammate sent their chests, some are missing, or the reports disagree.
function status(t) {
  if (!t.consistent) return `<span class="pill bad" title="${esc(t.issues.join(' · '))}">à vérifier</span>`;
  if (t.humans <= 1) return '<span class="pill ok">solo</span>';
  if (t.complete) return `<span class="pill ok">complet ${t.reported}/${t.humans}</span>`;
  return `<span class="pill part" title="Des coéquipiers n'ont pas (encore) envoyé leurs coffres : le total est un minimum.">${t.reported}/${t.humans} joueurs</span>`;
}
function members(t) {
  return '<div class="members">' + t.members.map(m => `<span>${playerLink(m.epicId, m.name)} <b class="num">${m.chests == null ? '?' : N(m.chests)}</b></span>`).join('')
    + (t.bots ? `<span class="mut">+ ${t.bots} bot${t.bots > 1 ? 's' : ''}</span>` : '') + '</div>';
}
function gamesTable(games) {
  if (!games.length) return '<div class="card"><p class="empty">Aucune partie pour l\'instant.</p></div>';
  return `<div class="card"><table><thead><tr><th>Partie</th><th class="hide-sm">Mode</th><th>Classement</th><th class="n">Coffres équipe</th><th>Joueurs</th><th class="hide-sm">Synchro</th></tr></thead><tbody>` +
    games.map(t => `<tr class="link" data-href="/g/${encodeURIComponent(t.sessionId)}"><td class="num nw">${when(t.startUtc)}</td><td class="hide-sm">${esc(mode(t.playlist))}</td><td class="num nw">${place(t)}</td><td class="n num big">${N(t.teamChests)}${t.complete ? '' : '+'}</td><td>${members(t)}</td><td class="hide-sm">${status(t)}</td></tr>`).join('') +
    '</tbody></table></div>';
}
function pager(id, items, size, render) {
  // Long lists, 10 or 20 at a time (like the counter's report).
  const pages = Math.max(1, Math.ceil(items.length / size));
  return `<div id="${id}" data-page="0" data-pages="${pages}">${render(items.slice(0, size))}</div>` + (pages > 1
    ? `<div class="pager" data-for="${id}"><button data-step="-1" disabled>←</button><span class="num">1 / ${pages}</span><button data-step="1">→</button></div>` : '');
}
const PAGERS = {};

// --- data ---------------------------------------------------------------------------------------------------------

async function load(key, path, maxAge = 30000) {
  const c = cache[key];
  if (c && Date.now() - c.at < maxAge) return c.data;
  const data = await api(path);
  cache[key] = { at: Date.now(), data };
  return data;
}
const overview = () => load('overview', '/api/overview?days=30');
const content = () => load('content', '/api/content', 600000);
const player = id => load('p:' + id, '/api/players/' + encodeURIComponent(id));

// --- routing ------------------------------------------------------------------------------------------------------

function route() {
  const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'p' && parts[1]) return { page: 'player', id: parts[1], tab: parts[2] || 'resume' };
  if (parts[0] === 'g' && parts[1]) return { page: 'game', id: parts[1] };
  if (parts[0] === 'parties') return { page: 'games' };
  if (parts[0] === 'groupes') return { page: 'groups' };
  if (parts[0] === 'aide') return { page: 'help' };
  if (parts[0] === 'chances') return { page: 'player', id: null, tab: 'chances' };
  if (parts[0] === 'collection') return { page: 'player', id: null, tab: 'collection' };
  return { page: 'group' };
}
function go(path) { history.pushState(null, '', withKey(path)); render(); }

function drawTabs(r, players) {
  const me = r.page === 'player' && r.id ? r.id : ME || players[0]?.epicId;
  const p = me ? '/p/' + encodeURIComponent(me) : null;
  const tabs = [
    ['Serveur', '/', r.page === 'group'],
    ['Groupes', '/groupes', r.page === 'groups'],
    ['Joueur', p, r.page === 'player' && r.tab === 'resume'],
    ['Chances', p && p + '/chances', r.page === 'player' && r.tab === 'chances'],
    ['Collection', p && p + '/collection', r.page === 'player' && r.tab === 'collection'],
    ['Parties', '/parties', r.page === 'games' || r.page === 'game'],
    ['Aide', '/aide', r.page === 'help'],
  ];
  $('#tabs').innerHTML = tabs.map(([name, href, on]) => href
    ? `<a href="${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${name}</a>` : `<span class="off">${name}</span>`).join('');
  $('#me').innerHTML = players.length
    ? players.map(x => `<option value="${esc(x.epicId)}" ${x.epicId === me ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    : '<option>—</option>';
}

async function render(scroll = true) {
  const r = route();
  const view = $('#view');
  try {
    const o = await overview();
    document.title = o.groupName;
    $('#brand').textContent = o.groupName;
    if (r.page === 'player' && !r.id) {
      const id = ME || o.players[0]?.epicId;
      if (id) { history.replaceState(null, '', withKey('/p/' + encodeURIComponent(id) + '/' + r.tab)); return render(); }
    }
    if (r.page === 'player' && r.id) { ME = r.id; try { localStorage.setItem('cc-me', ME); } catch (e) { } }
    drawTabs(r, o.players);
    let html;
    if (r.page === 'group') html = groupPage(o, await content());
    else if (r.page === 'player') html = !r.id ? empty() : await playerPage(r.id, r.tab);
    else if (r.page === 'groups') html = groupsPage(await load('groups', '/api/groups'), o);
    else if (r.page === 'games') html = await gamesPage(o);
    else if (r.page === 'game') html = await gamePage(r.id);
    else html = helpPage(o);
    view.innerHTML = html;
    if (scroll) window.scrollTo({ top: 0 });
  } catch (e) {
    view.innerHTML = `<div class="card warnc">${esc(e.message)}</div>`;
  }
}
function empty() { return '<div class="card"><p class="empty">Personne n\'a encore envoyé de partie. Dans ChestCounter : Réglages → Serveur de groupe (voir l\'onglet Aide).</p></div>'; }

// --- Groupe -------------------------------------------------------------------------------------------------------

function groupPage(o, c) {
  if (!o.players.length) return empty() + helpPage(o);
  const top = o.players[0];
  let h = `<section class="tiles">
    ${tile(N(o.totals.chests), 'coffres ouverts sur ce serveur, par ' + N(o.totals.players) + ' joueur' + (o.totals.players > 1 ? 's' : ''), 'hero')}
    ${tile(N(o.totals.today), "coffres aujourd'hui")}
    ${tile(N(o.totals.matches), 'parties')}
    ${tile(N(o.totals.groupGames), 'parties en groupe · ' + N(o.totals.groupChests) + ' coffres')}
    ${tile('★ ' + N(o.totals.treasures), 'trésors trouvés')}
    ${tile(esc(top.name), 'en tête · ' + N(top.chests) + ' coffres')}</section>`;
  h += treasureHourBanner(c);
  if (o.chances) {
    const big = o.chances.odds.filter(x => x.big);
    h += section('Les chances du serveur', `<div class="chances">${big.map(x => oddsCard(x, o.chances.chests, 'du groupe')).join('')}</div>`,
      `<span class="mut">au moins un joueur, avec les ${N(o.chances.chests)} coffres de tout le serveur</span>`);
  }
  h += section('Coffres par joueur', `<div class="card"><table><thead><tr><th>Joueur</th><th class="n">Coffres</th><th class="n">Parties</th><th class="n">Moyenne</th><th class="n hide-sm">Record</th><th class="n hide-sm">Trésors</th><th class="n hide-sm">Top 1</th><th class="hide-sm">Dernière partie</th></tr></thead><tbody>` +
    o.players.map((p, i) => `<tr class="link" data-href="/p/${encodeURIComponent(p.epicId)}"><td><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${playerLink(p.epicId, p.name)}</td><td class="n num big">${N(p.chests)}</td><td class="n num">${N(p.matches)}</td><td class="n num">${p.average.toLocaleString('fr-FR')}</td><td class="n num hide-sm">${N(p.best)}</td><td class="n num hide-sm">★ ${N(p.treasures)}</td><td class="n num hide-sm">${N(p.wins)}</td><td class="num hide-sm nw">${when(p.lastMatch)}</td></tr>`).join('') +
    '</tbody></table></div>');
  h += section('Coffres par jour', perDay(o), '<span class="mut">30 derniers jours</span>');
  h += section('Dernières parties', gamesTable(o.games.slice(0, 8)), '<a href="/parties">toutes les parties →</a>');
  return h;
}

function perDay(o) {
  // Stacked bars, one colour per player (same order as the ranking).
  const color = Object.fromEntries(o.players.map((p, i) => [p.epicId, PALETTE[i % PALETTE.length]]));
  const name = Object.fromEntries(o.players.map(p => [p.epicId, p.name]));
  const days = [];
  for (let d = 29; d >= 0; d--) { const x = new Date(); x.setDate(x.getDate() - d); days.push(x.toLocaleDateString('sv-SE')); }
  const byDay = Object.fromEntries(days.map(d => [d, []]));
  o.perDay.forEach(r => byDay[r.day] && byDay[r.day].push(r));
  const max = Math.max(1, ...days.map(d => byDay[d].reduce((s, r) => s + r.chests, 0)));
  return `<div class="card"><div class="bars">` + days.map(d => {
    const rows = byDay[d], total = rows.reduce((s, r) => s + r.chests, 0);
    const tip = new Date(d + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) + ' : ' + total + ' coffres' + rows.map(r => '\n' + name[r.epicId] + ' ' + r.chests).join('');
    return `<div class="col" title="${esc(tip)}">` + rows.map(r => `<div class="seg" style="height:${r.chests / max * 100}%;background:${color[r.epicId] || '#c9a24f'}"></div>`).join('') + '</div>';
  }).join('') + `</div><div class="axis"><span>il y a 30 jours</span><span>aujourd'hui</span></div>` +
    `<div class="legend">${o.players.map(p => `<span><i style="background:${color[p.epicId]}"></i>${esc(p.name)}</span>`).join('')}</div></div>`;
}

// --- Chances ------------------------------------------------------------------------------------------------------

function oddsCard(x, chests, who) {
  const width = Math.min(100, Math.max(0.6, x.chance * 100));
  return `<div class="odds"><div class="k">${esc(x.name)}</div><div class="v num">${pct(x.chance)}</div>
    <div class="l">de chances de l'avoir eu au moins une fois ${who === 'du groupe' ? 'sur le serveur' : 'avec ses ' + N(chests) + ' coffres'}</div>
    <span class="meter"><i style="width:${width}%"></i></span>
    <div class="s">1 sur ${N(x.oneIn)} à chaque coffre · une chance sur deux vers ${N(x.half)} coffres${x.left > 0 ? ` (encore ${N(x.left)})` : ''}</div></div>`;
}

function treasureHourBanner(c) {
  if (!c || !c.treasureHours?.length) return '';
  const now = Date.now();
  const hours = c.treasureHours.map(h => ({ ...h, s: Date.parse(h.start), e: Date.parse(h.end) }));
  const live = hours.find(h => now >= h.s && now < h.e);
  const next = hours.filter(h => h.s > now).sort((a, b) => a.s - b.s)[0];
  const boosts = h => Object.entries(h.boosts).map(([k, v]) => `${esc(c.kindNames[k] || k)} ×${String(v).replace('.', ',')}`).join(' · ');
  const at = t => new Date(t).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  if (live) return `<div class="banner live"><b>Heure du trésor en cours</b>, jusqu'à ${new Date(live.e).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} : ${boosts(live)}</div>`;
  if (next) return `<div class="banner"><b>Prochaine heure du trésor :</b> ${at(next.s)}${next.confirmed ? '' : ' (prévue, pas encore annoncée)'} · ${boosts(next)}</div>`;
  return '';
}

function chancesPage(d, c, o) {
  const ch = d.chances;
  if (!ch) return '<div class="card"><p class="empty">Pas de chasse au trésor en cours.</p></div>';
  const big = ch.odds.filter(x => x.big), other = ch.odds.filter(x => !x.big);
  let h = treasureHourBanner(c);
  h += section('Ses chances', `<div class="chances">${big.map(x => oddsCard(x, ch.chests)).join('')}</div>`, `<span class="mut">${N(ch.chests)} coffres · ${N(ch.boostedChests)} pendant une heure du trésor</span>`);
  h += `<div class="card" style="margin-top:12px"><table><thead><tr><th>Trésor</th><th class="n">Par coffre</th><th class="n">Au moins un</th><th class="n">En moyenne</th></tr></thead><tbody>` +
    other.map(x => `<tr><td>${esc(x.name)}${x.weekly ? ' <span class="mut">· change chaque semaine</span>' : ''}</td><td class="n num">1 / ${N(x.oneIn)}</td><td class="n num">${pct(x.chance)}</td><td class="n num">${x.average.toLocaleString('fr-FR', { maximumFractionDigits: x.average >= 10 ? 0 : 1 })}</td></tr>`).join('') +
    '</tbody></table></div>';
  if (o.chances && o.players.length > 1) {
    h += section('Et tout le serveur ?', `<div class="chances">${o.chances.odds.filter(x => x.big).map(x => oddsCard(x, o.chances.chests, 'du groupe')).join('')}</div>`, `<span class="mut">avec les ${N(o.chances.chests)} coffres de tous les joueurs</span>`);
  }
  h += `<p class="note">Chaque coffre a toujours la même chance (1 sur 1 562 500 pour la tenue en or) : elle n'augmente pas d'un coffre à l'autre. Ce qui augmente, c'est la chance de l'avoir obtenu au moins une fois sur l'ensemble des coffres : 1 − (1 − 1/X)^N. Les coffres ouverts pendant une heure du trésor comptent avec leurs chances augmentées. Cotes publiées par Epic Games.</p>`;
  return h;
}

// --- Collection ---------------------------------------------------------------------------------------------------

function collectionPage(id, d, c) {
  const auto = new Set(d.collection.auto), ticked = new Set(d.collection.ticked);
  const all = [c.pirateShop, ...c.weeks.flatMap(w => w.prizes)].filter(Boolean);
  const got = all.filter(p => auto.has(p.id) || ticked.has(p.id)).length;
  const prize = p => {
    const a = auto.has(p.id), t = !a && ticked.has(p.id);
    return `<label class="prize${a || t ? ' got' : ''}"><input type="checkbox" data-prize="${esc(p.id)}" data-player="${esc(id)}" ${a ? 'checked disabled' : t ? 'checked' : ''}>
      <span class="pimg">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
      <span class="pn">${esc(p.name)}</span><span class="pk">${esc(p.kindName)}${a ? ' · vu dans ses replays' : ''}</span></label>`;
  };
  let h = section('Collection', '', `<span class="num big">${got} / ${all.length}</span>`);
  h += `<div class="card collection">`;
  if (c.pirateShop) h += `<div class="wk"><div class="wt">Toute la saison</div><div class="prizes">${prize(c.pirateShop)}</div></div>`;
  for (const w of c.weeks) {
    const dates = new Date(w.start).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' – ' + new Date(w.end).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
    h += `<div class="wk${w.current ? ' now' : ''}"><div class="wt">Semaine ${w.number} · ${esc(w.title)} <span class="mut">${dates}${w.current ? ' · cette semaine' : ''}</span></div>` +
      (w.prizes.length ? `<div class="prizes">${w.prizes.map(prize).join('')}</div>` : '<p class="mut">Récompenses pas encore dévoilées.</p>') + '</div>';
  }
  h += `</div><p class="note">Un trésor sorti d'un coffre doré est coché tout seul quand le compteur le reconnaît dans les replays. Coche le reste à la main : c'est enregistré sur le serveur, visible par tout le groupe.</p>`;
  return h;
}

// --- Joueur -------------------------------------------------------------------------------------------------------

async function playerPage(id, tab) {
  const [d, c, o] = await Promise.all([player(id), content(), overview()]);
  const p = d.player;
  const sub = [['resume', 'Résumé'], ['chances', 'Chances'], ['collection', 'Collection'], ['parties', 'Parties']];
  let h = `<div class="phead"><h1 class="pirate">${esc(p.name)}</h1><nav class="subtabs">${sub.map(([k, n]) => `<a href="/p/${encodeURIComponent(id)}${k === 'resume' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}">${n}</a>`).join('')}</nav></div>`;
  if (tab === 'chances') return h + chancesPage(d, c, o);
  if (tab === 'collection') return h + collectionPage(id, d, c);
  if (tab === 'parties') return h + section('Ses parties', pager('pgames', d.games, 20, gamesTable), `<span class="mut">${N(d.games.length)} parties</span>`);

  const sp = d.split;
  h += `<section class="tiles">
    ${tile(N(p.chests), 'coffres ouverts en tout', 'hero')}
    ${tile(N(sp.groupChests), 'en groupe · ' + N(sp.groupGames) + ' partie' + (sp.groupGames > 1 ? 's' : '') + ' (équipe : ' + N(sp.groupTeamChests) + ')')}
    ${tile(N(sp.otherChests), 'hors groupe · ' + N(sp.otherGames) + ' partie' + (sp.otherGames > 1 ? 's' : ''))}
    ${tile(N(p.matches), 'parties · moy. ' + p.average.toLocaleString('fr-FR') + ' · record ' + N(p.best))}
    ${tile('★ ' + N(p.treasures), 'trésors')}
    ${tile(N(p.wins), 'Top 1 · ' + N(p.eliminations) + ' éliminations')}</section>`;
  const outfit = d.chances?.odds.find(x => x.kind === 'outfit');
  if (outfit) h += `<a class="card chancelink" href="/p/${encodeURIComponent(id)}/chances"><span>Tenue en or : <b class="num">${pct(outfit.chance)}</b> de chances de l'avoir eue avec ses coffres</span><span>Voir ses chances →</span></a>`;
  if (d.lineups.length) h += section('Ses groupes', lineupsTable(d.lineups), "<span class=\"mut\">les parties jouées avec d'autres joueurs du serveur</span>");
  h += section('Dernières parties', gamesTable(d.games.slice(0, 6)), `<a href="/p/${encodeURIComponent(id)}/parties">toutes ses parties →</a>`);
  const kinds = Object.entries(d.chestKinds).sort((a, b) => b[1] - a[1]);
  const kmax = Math.max(1, ...kinds.map(k => k[1]));
  h += `<div class="cols">` + section('Types de coffres', `<div class="card">${kinds.length ? '<table><tbody>' + kinds.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n num big" style="width:60px">${N(n)}</td><td style="width:45%"><span class="meter"><i style="width:${n / kmax * 100}%"></i></span></td></tr>`).join('') + '</tbody></table>' : '<p class="empty">—</p>'}</div>`)
    + section('Trésors trouvés', `<div class="card">${d.treasures.length ? '<table><tbody>' + d.treasures.map(t => `<tr><td class="num nw">${when(t.startUtc)}</td><td>★ ${esc(t.name)}</td></tr>`).join('') + '</tbody></table>' : '<p class="empty">Aucun trésor pour l\'instant.</p>'}</div>`) + '</div>';
  const obs = location.origin + '/overlay/' + encodeURIComponent(id) + (KEY ? '?k=' + encodeURIComponent(KEY) : '');
  h += section('Overlay pour OBS', `<div class="card"><p style="margin-top:0">Dans OBS : <i>Sources → + → Navigateur</i>, colle cette adresse, largeur 380 × hauteur 240. Le fond est transparent et les chiffres se mettent à jour tout seuls (total, dernière partie, équipe).</p>
    <div class="copy"><code>${esc(obs)}</code><button data-copy="${esc(obs)}">Copier</button><a class="btn" href="${esc(obs)}" target="_blank" rel="noopener">Aperçu</a></div></div>`);
  return h;
}

// --- Groupes -----------------------------------------------------------------------------------------------------

function lineupsTable(lineups) {
  return `<div class="card"><table><thead><tr><th>Groupe</th><th class="n">Parties</th><th class="n">Coffres</th><th class="n">Moyenne</th><th class="n hide-sm">Record</th><th class="n hide-sm">Top 1</th><th class="hide-sm">Dernière</th></tr></thead><tbody>` +
    lineups.map(g => `<tr><td>${g.lineup.map((id, i) => playerLink(id, g.names[i])).join(' · ')}</td><td class="n num">${N(g.games)}</td><td class="n num big">${N(g.chests)}${g.complete < g.games ? '<span class="mut" title="Des parties n&#39;ont pas été envoyées par tous : le total est un minimum.">+</span>' : ''}</td><td class="n num">${g.average.toLocaleString('fr-FR')}</td><td class="n num hide-sm">${N(g.best)}</td><td class="n num hide-sm">${N(g.wins)}</td><td class="num hide-sm nw">${when(g.lastUtc)}</td></tr>`).join('') +
    '</tbody></table></div>';
}

const GROUP_RULE = "Une partie compte comme « en groupe » quand au moins deux joueurs de ce serveur étaient dans la même équipe.";

function groupsPage(g, o) {
  const t = g.totals;
  if (!t.games) return section('Groupes', `<div class="card"><p class="empty">Aucune partie en groupe pour l'instant. ${GROUP_RULE}</p></div>`);
  let h = `<section class="tiles">
    ${tile(N(t.games), 'parties en groupe', 'hero')}
    ${tile(N(t.chests), 'coffres ouverts en groupe')}
    ${tile(t.average.toLocaleString('fr-FR'), 'coffres par partie en groupe')}
    ${tile(N(t.best), "record d'une équipe en une partie")}
    ${tile(N(t.wins), 'Top 1 en groupe')}
    ${tile(N(t.complete) + ' / ' + N(t.games), 'parties envoyées par tout le monde')}</section>`;
  h += `<p class="note">${GROUP_RULE} Ses coffres sont ceux de toute l'équipe, chacun comptant les siens. Les parties jouées seul ou avec des inconnus restent dans l'onglet Serveur et sur les pages des joueurs.</p>`;
  h += section('Les groupes', lineupsTable(g.lineups), '<span class="mut">chaque combinaison de joueurs du serveur</span>');
  h += section('Les joueurs en groupe', `<div class="card"><table><thead><tr><th>Joueur</th><th class="n">Parties en groupe</th><th class="n">Ses coffres en groupe</th><th class="n">Moyenne</th></tr></thead><tbody>` +
    g.players.map(p => `<tr><td>${playerLink(p.epicId, p.name)}</td><td class="n num">${N(p.games)}${p.sent < p.games ? ` <span class="mut" title="parties qu'il n'a pas envoyées">(${N(p.games - p.sent)} non envoyée${p.games - p.sent > 1 ? 's' : ''})</span>` : ''}</td><td class="n num big">${N(p.chests)}</td><td class="n num">${p.average.toLocaleString('fr-FR')}</td></tr>`).join('') +
    '</tbody></table></div>');
  h += section('Dernières parties en groupe', gamesTable(g.games), '<a href="/parties?vue=groupe">toutes les parties en groupe →</a>');
  return h;
}

// Every match, 20 at a time, from the server (nothing is ever deleted): all, in group, or one player's.
async function gamesPage(o) {
  const q = new URLSearchParams(location.search);
  const scope = q.get('vue') === 'groupe' ? 'group' : 'all';
  const who = q.get('joueur') || '';
  const page = Math.max(0, (+q.get('page') || 1) - 1);
  const d = await api(`/api/games?scope=${scope}&player=${encodeURIComponent(who)}&offset=${page * 20}&limit=20`);
  const pages = Math.max(1, Math.ceil(d.total / 20));
  const link = (vue, joueur, p) => '/parties?' + new URLSearchParams({ ...(vue ? { vue } : {}), ...(joueur ? { joueur } : {}), ...(p > 1 ? { page: p } : {}) });
  const filters = `<div class="filters"><a class="chip ${scope === 'all' ? 'on' : ''}" href="${link('', who, 1)}">Toutes</a><a class="chip ${scope === 'group' ? 'on' : ''}" href="${link('groupe', who, 1)}">En groupe</a>
    <select id="gamesWho" aria-label="Joueur"><option value="">Tous les joueurs</option>${o.players.map(p => `<option value="${esc(p.epicId)}" ${p.epicId === who ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
  const off = 'aria-disabled="true" style="pointer-events:none;opacity:.4"';
  const nav = pages > 1 ? `<div class="pager"><a class="btn" href="${link(q.get('vue'), who, page)}" ${page === 0 ? off : ''}>←</a><span class="num">${page + 1} / ${pages}</span><a class="btn" href="${link(q.get('vue'), who, page + 2)}" ${page >= pages - 1 ? off : ''}>→</a></div>` : '';
  return section(scope === 'group' ? 'Parties en groupe' : 'Toutes les parties', filters + gamesTable(d.games) + nav, `<span class="mut">${N(d.total)} partie${d.total > 1 ? 's' : ''}</span>`);
}

// --- Partie -------------------------------------------------------------------------------------------------------

async function gamePage(id) {
  const d = await api('/api/games/' + encodeURIComponent(id));
  const t0 = d.teams[0];
  // Several teams of the group can be in the same match (friends in different squads): one card each.
  return `<div class="phead"><h1 class="pirate">Partie du ${when(t0.startUtc, true)}</h1></div>` + d.teams.map(t => `<div class="card">
    <div class="gsum"><span class="num gbig">${N(t.teamChests)}${t.complete ? '' : '+'}</span><span class="mut">coffres de l'équipe</span>
      <span>${esc(mode(t.playlist))}</span><span class="num">${place(t)}</span>${t.durationSeconds ? `<span class="mut num">${Math.round(t.durationSeconds / 60)} min</span>` : ''}${status(t)}</div>
    <table><thead><tr><th>Joueur</th><th class="n">Coffres</th><th class="n">dont détruits</th><th class="n hide-sm">Éliminations</th><th class="n">Trésors</th></tr></thead><tbody>
    ${t.members.map(m => `<tr><td>${playerLink(m.epicId, m.name)}</td>${m.chests == null ? '<td class="n mut" colspan="4">n\'a pas envoyé cette partie</td>' : `<td class="n num big">${N(m.chests)}</td><td class="n num">${N(m.destroyed)}</td><td class="n num hide-sm">${N(m.eliminations)}</td><td class="n num">★ ${N(m.treasures)}</td>`}</tr>`).join('')}
    ${t.bots ? `<tr><td class="mut" colspan="5">+ ${t.bots} bot${t.bots > 1 ? 's' : ''} (non comptés)</td></tr>` : ''}
    </tbody></table>
    ${t.issues.length ? `<ul class="issues">${t.issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
    <p class="mut small">Identifiant de partie : <span class="num">${esc(t.sessionId)}</span></p></div>`).join('');
}

// --- Aide ---------------------------------------------------------------------------------------------------------

function helpPage(o) {
  const site = location.origin;
  return section('Rejoindre le groupe', `<div class="card prose">
    <ol>
      <li>Active les rediffusions dans Fortnite : <i>Paramètres → Jeu → Rediffusions → Enregistrer les rediffusions : Activé</i>.</li>
      <li>Lance <b>ChestCounter.exe</b>. Au premier lancement, il demande l'adresse du serveur et la clé du groupe (sinon : <i>Réglages → Serveur de groupe</i>).</li>
      <li>Adresse du serveur : <code>${esc(site)}</code>. La clé du groupe t'est donnée par celui qui héberge le serveur.</li>
      <li>Laisse le compteur ouvert pendant que tu joues : quelques secondes après chaque partie, tes coffres arrivent ici.</li>
    </ol></div>`)
    + section('Serveur et groupes', `<div class="card prose">
    <p><b>Serveur</b> : tout ce que les joueurs de ce serveur ont envoyé, toutes parties confondues (seul, en groupe ou avec des inconnus). <b>Groupes</b> : uniquement les parties où au moins deux joueurs du serveur étaient dans la même équipe.</p>
    <p>Rien n'est jamais effacé : les parties restent ici même quand Fortnite supprime ses anciens replays.</p></div>`)
    + section('Comment les coffres sont additionnés', `<div class="card prose">
    <p>Chaque compteur lit <b>uniquement les coffres de son joueur</b> dans ses replays, et envoie avec eux l'identifiant de la partie (le même dans le replay de tous les joueurs de la partie), son numéro d'équipe et ses coéquipiers.</p>
    <p>Le serveur range les envois par partie puis par équipe, et additionne : un coffre n'est jamais compté deux fois. Un coéquipier sans le compteur n'est pas deviné : la partie affiche <span class="pill part">2/4 joueurs</span> et un total avec « + ». Si les envois d'une équipe ne concordent pas (équipe, coéquipiers, classement ou mode différents), la partie est marquée <span class="pill bad">à vérifier</span>.</p>
    <p>Rien n'est gardé sur les joueurs hors du groupe : un coéquipier aléatoire apparaît comme « Coéquipier hors groupe ».</p></div>`)
    + section('Stream (OBS)', `<div class="card prose"><p>Chaque joueur a une page overlay transparente : onglet <b>Joueur</b>, en bas, « Overlay pour OBS ». À ajouter dans OBS comme source <i>Navigateur</i> (380 × 240).</p></div>`)
    + section('Pour celui qui héberge le serveur', `<div class="card prose">
    <p>Voir ou changer les clés (sans redémarrer) :</p>
    <pre>docker compose exec chests python -m app.admin show
docker compose exec chests python -m app.admin rotate group   # nouvelle clé d'envoi
docker compose exec chests python -m app.admin rotate view    # nouvelle clé de lecture du site
docker compose exec chests python -m app.admin clear view     # site lisible par qui a l'adresse</pre>
    <p>Après <code>rotate group</code>, chaque ami met la nouvelle clé dans ChestCounter. Détails : <code>SERVEUR.md</code> dans le dépôt.</p></div>`);
}

// --- events -------------------------------------------------------------------------------------------------------

document.addEventListener('click', e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); copy.textContent = 'Copié'; return; }
  const step = e.target.closest('.pager button');
  if (step) {
    const box = document.getElementById(step.parentElement.dataset.for);
    const page = Math.min(Math.max(0, +box.dataset.page + +step.dataset.step), +box.dataset.pages - 1);
    box.dataset.page = page;
    const r = route();
    const source = cache['p:' + r.id].data.games;
    box.innerHTML = gamesTable(source.slice(page * 20, page * 20 + 20));
    const btns = step.parentElement.querySelectorAll('button');
    btns[0].disabled = page === 0; btns[1].disabled = page === +box.dataset.pages - 1;
    step.parentElement.querySelector('span').textContent = (page + 1) + ' / ' + box.dataset.pages;
    return;
  }
  const row = e.target.closest('tr[data-href]');
  const a = e.target.closest('a[href^="/"]');
  const href = a && !a.target ? a.getAttribute('href') : (!a && row ? row.dataset.href : null);
  if (href && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); go(href); }
});

document.addEventListener('change', async e => {
  if (e.target.id === 'gamesWho') {
    const q = new URLSearchParams(location.search); q.delete('page');
    if (e.target.value) q.set('joueur', e.target.value); else q.delete('joueur');
    go('/parties' + (q.toString() ? '?' + q : ''));
    return;
  }
  if (e.target.id === 'me') {
    const r = route(), id = e.target.value;
    go('/p/' + encodeURIComponent(id) + (r.page === 'player' && r.tab !== 'resume' ? '/' + r.tab : ''));
    return;
  }
  const box = e.target.closest('input[data-prize]');
  if (box) {
    box.disabled = true;
    try {
      await api('/api/players/' + encodeURIComponent(box.dataset.player) + '/obtained', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prizeId: box.dataset.prize, on: box.checked }),
      });
      delete cache['p:' + box.dataset.player];
      box.closest('.prize').classList.toggle('got', box.checked);
    } catch (err) { box.checked = !box.checked; alert(err.message); }
    box.disabled = false;
  }
});

window.addEventListener('popstate', () => render());
render();
// New matches arrive a few seconds after each game: refresh the page data every minute (not while ticking).
setInterval(() => { if (!document.hidden && !document.activeElement?.matches('input,select')) { delete cache.overview; delete cache.groups; Object.keys(cache).filter(k => k.startsWith('p:')).forEach(k => delete cache[k]); render(false); } }, 60000);
