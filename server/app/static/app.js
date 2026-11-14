// The group site: one page, tabs drawn from the address (/, /groupes, /p/<id>, /p/<id>/chances, /p/<id>/collection,
// /parties, /g/<match>, /aide), like the tabs of the ChestCounter window. Texts in i18n.js (fr, en, es).
const PALETTE = ['#c9a24f', '#1f7f7a', '#6c3fb5', '#a3361f', '#3a6ea5', '#7a8b2e', '#b5567d', '#4f7f3a'];
const cache = {};
let ME = null;
try { ME = localStorage.getItem('cc-me'); } catch (e) { /* private mode */ }

// --- formatting -------------------------------------------------------------------------------------------------

function when(iso, withYear) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(loc(), { day: '2-digit', month: '2-digit', ...(withYear ? { year: 'numeric' } : {}) }) + ' ' + d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
}
const dec = (v, digits = 1) => Number(v).toLocaleString(loc(), { maximumFractionDigits: digits });
const pctUnit = v => (LANG === 'en' ? v + '%' : v + ' %');
// Like the counter: never "100 %" (">99.9 %" with the chance of never having had it in the tooltip).
function pct(p) {
  const v = p * 100;
  if (v >= 99.95) return pctUnit('>' + dec(99.9));
  if (v >= 10) return pctUnit(dec(v, 1));
  if (v >= 0.1) return pctUnit(dec(v, 2));
  if (v === 0) return pctUnit('0');
  return pctUnit(v.toLocaleString(loc(), { maximumSignificantDigits: 2 }));
}
const PLAYLISTS = [[/nobuild|zb|zerobuild/i, 'modeZero'], [/squad/i, 'modeSquad'], [/trio/i, 'modeTrio'], [/duo/i, 'modeDuo'], [/solo/i, 'modeSolo']];
function mode(p) {
  if (!p) return '—';
  const parts = PLAYLISTS.filter(([re]) => re.test(p)).map(([, k]) => t(k));
  return parts.length ? [...new Set(parts)].join(' · ') : p.replace(/^Playlist_/, '');
}
function place(x) {
  if (x.placement == null) return '—';
  return x.placement === 1 ? '<b class="win">Top 1</b>' : '#' + x.placement + (x.totalPlayers ? '<span class="mut">/' + x.totalPlayers + '</span>' : '');
}
const kindName = k => t('kind_' + k);
function playerLink(id, name) { return id ? `<a href="/p/${encodeURIComponent(id)}">${esc(name)}</a>` : `<span class="mut">${esc(name)}</span>`; }
function tile(value, label, cls = '') { return `<div class="tile ${cls}"><div class="v num">${value}</div><div class="l">${label}</div></div>`; }
function section(title, body, extra = '') { return `<section><div class="sh"><h2 class="pirate">${title}</h2>${extra}</div>${body}</section>`; }
const memberName = m => m.outside ? t('outsideMate') : (m.name || t('unknownPlayer'));
function issueText(i) {
  if (typeof i === 'string') return i;
  return t('issue_' + i.code, i.code === 'roster' ? { player: i.player, missing: (i.missing || []).join(', ') } : {});
}

// Status of a team in a match: every human teammate sent their chests, some are missing, or the reports disagree.
function status(x) {
  if (!x.consistent) return `<span class="pill bad" title="${esc(x.issues.map(issueText).join(' · '))}">${t('toCheck')}</span>`;
  if (x.humans <= 1) return `<span class="pill ok">${t('solo')}</span>`;
  if (x.complete) return `<span class="pill ok">${t('complete', { a: x.reported, b: x.humans })}</span>`;
  return `<span class="pill part" title="${esc(t('partialWhy'))}">${t('partial', { a: x.reported, b: x.humans })}</span>`;
}
function members(x) {
  return '<div class="members">' + x.members.map(m => `<span>${playerLink(m.epicId, memberName(m))} <b class="num">${m.chests == null ? '?' : N(m.chests)}</b></span>`).join('')
    + (x.bots ? `<span class="mut">${t('bots', { n: x.bots })}</span>` : '') + '</div>';
}
function gamesTable(games) {
  if (!games.length) return `<div class="card"><p class="empty">${t('noGames')}</p></div>`;
  return `<div class="card"><table><thead><tr><th>${t('colMatch')}</th><th class="hide-sm">${t('colMode')}</th><th>${t('colPlace')}</th><th class="n">${t('colTeamChests')}</th><th>${t('colPlayers')}</th><th class="hide-sm">${t('colSync')}</th></tr></thead><tbody>` +
    games.map(x => `<tr class="link" data-href="/g/${encodeURIComponent(x.sessionId)}"><td class="num nw">${when(x.startUtc)}</td><td class="hide-sm">${esc(mode(x.playlist))}</td><td class="num nw">${place(x)}</td><td class="n num big">${N(x.teamChests)}${x.complete ? '' : '+'}</td><td>${members(x)}</td><td class="hide-sm">${status(x)}</td></tr>`).join('') +
    '</tbody></table></div>';
}
function pager(id, items, size, render) {
  // Long lists, 20 at a time (like the counter's report).
  const pages = Math.max(1, Math.ceil(items.length / size));
  return `<div id="${id}" data-page="0" data-pages="${pages}">${render(items.slice(0, size))}</div>` + (pages > 1
    ? `<div class="pager" data-for="${id}"><button data-step="-1" disabled>←</button><span class="num">1 / ${pages}</span><button data-step="1">→</button></div>` : '');
}

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

function drawChrome(r, players) {
  const me = r.page === 'player' && r.id ? r.id : ME || players[0]?.epicId;
  const p = me ? '/p/' + encodeURIComponent(me) : null;
  const tabs = [
    ['tabServer', '/', r.page === 'group'],
    ['tabGroups', '/groupes', r.page === 'groups'],
    ['tabPlayer', p, r.page === 'player' && r.tab === 'resume'],
    ['tabChances', p && p + '/chances', r.page === 'player' && r.tab === 'chances'],
    ['tabCollection', p && p + '/collection', r.page === 'player' && r.tab === 'collection'],
    ['tabGames', '/parties', r.page === 'games' || r.page === 'game'],
    ['tabHelp', '/aide', r.page === 'help'],
  ];
  $('#tabs').innerHTML = tabs.map(([key, href, on]) => href
    ? `<a href="${href}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${t(key)}</a>` : `<span class="off">${t(key)}</span>`).join('');
  $('#meLabel').textContent = t('player');
  $('#me').innerHTML = players.length
    ? players.map(x => `<option value="${esc(x.epicId)}" ${x.epicId === me ? 'selected' : ''}>${esc(x.name)}</option>`).join('')
    : '<option>—</option>';
  $('#lang').setAttribute('aria-label', t('language'));
  $('#lang').innerHTML = Object.entries(LANGS).map(([k, n]) => `<option value="${k}" ${k === LANG ? 'selected' : ''}>${n}</option>`).join('');
  $('#footText').textContent = t('footer');
  $('#footLegal').textContent = t('footerLegal');
}

let langPicked = false;
async function render(scroll = true) {
  const r = route();
  const view = $('#view');
  try {
    const o = await overview();
    if (!langPicked) { setLang(pickLang(o.defaultLang)); langPicked = true; }
    document.title = o.groupName;
    $('#brand').textContent = o.groupName;
    if (r.page === 'player' && !r.id) {
      const id = ME || o.players[0]?.epicId;
      if (id) { history.replaceState(null, '', withKey('/p/' + encodeURIComponent(id) + '/' + r.tab)); return render(); }
    }
    if (r.page === 'player' && r.id) { ME = r.id; try { localStorage.setItem('cc-me', ME); } catch (e) { } }
    drawChrome(r, o.players);
    let html;
    if (r.page === 'group') html = groupPage(o, await content());
    else if (r.page === 'player') html = !r.id ? empty() : await playerPage(r.id, r.tab);
    else if (r.page === 'groups') html = groupsPage(await load('groups', '/api/groups'));
    else if (r.page === 'games') html = await gamesPage(o);
    else if (r.page === 'game') html = await gamePage(r.id);
    else html = helpPage();
    view.innerHTML = html;
    if (scroll) window.scrollTo({ top: 0 });
  } catch (e) {
    view.innerHTML = `<div class="card warnc">${esc(e.message)}</div>`;
  }
}
function empty() { return `<div class="card"><p class="empty">${t('empty')}</p></div>`; }

// --- Serveur ------------------------------------------------------------------------------------------------------

function groupPage(o, c) {
  if (!o.players.length) return empty() + helpPage();
  const top = o.players[0];
  let h = `<section class="tiles">
    ${tile(N(o.totals.chests), t('tServerChests', { n: o.totals.players }), 'hero')}
    ${tile(N(o.totals.today), t('tToday'))}
    ${tile(N(o.totals.matches), t('tMatches'))}
    ${tile(N(o.totals.groupGames), t('tGroupGames', { n: o.totals.groupChests }))}
    ${tile('★ ' + N(o.totals.treasures), t('tTreasures'))}
    ${tile(esc(top.name), t('tTop', { n: top.chests }))}</section>`;
  h += treasureHourBanner(c);
  if (o.chances) {
    const big = o.chances.odds.filter(x => x.big);
    h += section(t('serverChances'), `<div class="chances">${big.map(x => oddsCard(x, 'server')).join('')}</div>`,
      `<span class="mut">${t('serverChancesSub', { n: o.chances.chests })}</span>`);
  }
  h += section(t('chestsPerPlayer'), `<div class="card"><table><thead><tr><th>${t('colPlayer')}</th><th class="n">${t('colChests')}</th><th class="n">${t('colGames')}</th><th class="n">${t('colAverage')}</th><th class="n hide-sm">${t('colBest')}</th><th class="n hide-sm">${t('colTreasures')}</th><th class="n hide-sm">${t('colTop1')}</th><th class="hide-sm">${t('colLast')}</th></tr></thead><tbody>` +
    o.players.map((p, i) => `<tr class="link" data-href="/p/${encodeURIComponent(p.epicId)}"><td><i class="dot" style="background:${PALETTE[i % PALETTE.length]}"></i>${playerLink(p.epicId, p.name)}</td><td class="n num big">${N(p.chests)}</td><td class="n num">${N(p.matches)}</td><td class="n num">${dec(p.average)}</td><td class="n num hide-sm">${N(p.best)}</td><td class="n num hide-sm">★ ${N(p.treasures)}</td><td class="n num hide-sm">${N(p.wins)}</td><td class="num hide-sm nw">${when(p.lastMatch)}</td></tr>`).join('') +
    '</tbody></table></div>');
  h += section(t('perDay'), perDay(o), `<span class="mut">${t('last30')}</span>`);
  h += section(t('lastGames'), gamesTable(o.games.slice(0, 8)), `<a href="/parties">${t('allGamesLink')}</a>`);
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
    const tip = t('dayTip', { day: new Date(d + 'T12:00').toLocaleDateString(loc(), { weekday: 'short', day: 'numeric', month: 'short' }), n: total }) + rows.map(r => '\n' + name[r.epicId] + ' ' + r.chests).join('');
    return `<div class="col" title="${esc(tip)}">` + rows.map(r => `<div class="seg" style="height:${r.chests / max * 100}%;background:${color[r.epicId] || '#c9a24f'}"></div>`).join('') + '</div>';
  }).join('') + `</div><div class="axis"><span>${t('daysAgo30')}</span><span>${t('today')}</span></div>` +
    `<div class="legend">${o.players.map(p => `<span><i style="background:${color[p.epicId]}"></i>${esc(p.name)}</span>`).join('')}</div></div>`;
}

// --- Chances ------------------------------------------------------------------------------------------------------

function oddsCard(x, who) {
  const width = Math.min(100, Math.max(0.6, x.chance * 100));
  const label = who === 'server' ? t('oddsServer') : x.weekly ? t('oddsWeek', { n: x.chests }) : t('oddsAll', { n: x.chests });
  return `<div class="odds"><div class="k">${esc(kindName(x.kind))}</div><div class="v num" title="${esc(t('neverTip', { p: pct(x.never ?? 1 - x.chance) }))}">${pct(x.chance)}</div>
    <div class="l">${label}</div>
    <span class="meter"><i style="width:${width}%"></i></span>
    <div class="s">${t('oddsLine', { one: N(x.oneIn), half: N(x.half) })}${x.left > 0 ? t('oddsLeft', { n: x.left }) : ''}</div>
    ${x.season != null && who !== 'server' ? `<div class="s">${t('oddsSeason', { p: pct(x.season) })}</div>` : ''}</div>`;
}

function treasureHourBanner(c) {
  if (!c || !c.treasureHours?.length) return '';
  const now = Date.now();
  const hours = c.treasureHours.map(h => ({ ...h, s: Date.parse(h.start), e: Date.parse(h.end) }));
  const live = hours.find(h => now >= h.s && now < h.e);
  const next = hours.filter(h => h.s > now).sort((a, b) => a.s - b.s)[0];
  const boosts = h => Object.entries(h.boosts).map(([k, v]) => `${esc(kindName(k))} ×${dec(v)}`).join(' · ');
  const at = ts => new Date(ts).toLocaleString(loc(), { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  if (live) return `<div class="banner live">${t('thLive', { t: new Date(live.e).toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' }), b: boosts(live) })}</div>`;
  if (next) return `<div class="banner"><b>${t('thNext', { t: at(next.s) })}</b>${next.confirmed ? '' : t('thExpected')} · ${boosts(next)}</div>`;
  return '';
}

function chancesPage(d, c, o) {
  const ch = d.chances;
  if (!ch) return `<div class="card"><p class="empty">${t('noHunt')}</p></div>`;
  const big = ch.odds.filter(x => x.big), other = ch.odds.filter(x => !x.big);
  let h = treasureHourBanner(c);
  const sub = t('chancesSub', { n: N(ch.chests), w: N(ch.weekChests), b: N(ch.boostedChests) }) + (ch.week ? ' · ' + esc(t('weekOf', { n: String(ch.week.number), title: ch.week.title })) : '');
  h += section(t('hisChances'), `<div class="chances">${big.map(x => oddsCard(x)).join('')}</div>`, `<span class="mut">${sub}</span>`);
  h += `<div class="card" style="margin-top:12px"><table><thead><tr><th>${t('colTreasure')}</th><th class="n">${t('colPerChest')}</th><th class="n">${t('colAtLeastOne')}</th><th class="n">${t('colOnAverage')}</th></tr></thead><tbody>` +
    other.map(x => `<tr><td>${esc(kindName(x.kind))} <span class="mut">· ${x.weekly ? t('weeklyNote') : t('seasonNote')}</span>${x.season != null ? `<div class="mut small">${t('oddsSeason', { p: pct(x.season) })}</div>` : ''}</td><td class="n num">1 / ${N(x.oneIn)}</td><td class="n num" title="${esc(t('neverTip', { p: pct(x.never) }))}">${pct(x.chance)}</td><td class="n num">${dec(x.average, x.average >= 10 ? 0 : 1)}</td></tr>`).join('') +
    '</tbody></table></div>';
  if (o.chances && o.players.length > 1) {
    h += section(t('andServer'), `<div class="chances">${o.chances.odds.filter(x => x.big).map(x => oddsCard(x, 'server')).join('')}</div>`, `<span class="mut">${t('andServerSub', { n: o.chances.chests })}</span>`);
  }
  h += `<p class="note">${t('chancesNote')}</p>`;
  return h;
}

// --- Collection ---------------------------------------------------------------------------------------------------

function collectionPage(id, d, c) {
  const auto = new Set(d.collection.auto), ticked = new Set(d.collection.ticked);
  const all = [c.pirateShop, ...c.weeks.flatMap(w => w.prizes)].filter(Boolean);
  const got = all.filter(p => auto.has(p.id) || ticked.has(p.id)).length;
  const prize = p => {
    const a = auto.has(p.id), tk = !a && ticked.has(p.id);
    return `<label class="prize${a || tk ? ' got' : ''}"><input type="checkbox" data-prize="${esc(p.id)}" data-player="${esc(id)}" ${a ? 'checked disabled' : tk ? 'checked' : ''}>
      <span class="pimg">${p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</span>
      <span class="pn">${esc(p.name)}</span><span class="pk">${esc(kindName(p.kind))}${a ? t('seenInReplays') : ''}</span></label>`;
  };
  let h = section(t('tabCollection'), '', `<span class="num big">${got} / ${all.length}</span>`);
  h += `<div class="card collection">`;
  if (c.pirateShop) h += `<div class="wk"><div class="wt">${t('allSeason')}</div><div class="prizes">${prize(c.pirateShop)}</div></div>`;
  for (const w of c.weeks) {
    const dates = new Date(w.start).toLocaleDateString(loc(), { day: 'numeric', month: 'short' }) + ' – ' + new Date(w.end).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
    h += `<div class="wk${w.current ? ' now' : ''}"><div class="wt">${esc(t('week', { n: String(w.number), title: w.title }))} <span class="mut">${dates}${w.current ? t('thisWeek') : ''}</span></div>` +
      (w.prizes.length ? `<div class="prizes">${w.prizes.map(prize).join('')}</div>` : `<p class="mut">${t('notRevealed')}</p>`) + '</div>';
  }
  h += `</div><p class="note">${t('collectionNote')}</p>`;
  return h;
}

// --- Joueur -------------------------------------------------------------------------------------------------------

async function playerPage(id, tab) {
  const [d, c, o] = await Promise.all([player(id), content(), overview()]);
  const p = d.player;
  const sub = [['resume', 'subSummary'], ['chances', 'tabChances'], ['collection', 'tabCollection'], ['parties', 'tabGames']];
  let h = `<div class="phead"><h1 class="pirate">${esc(p.name)}</h1><nav class="subtabs">${sub.map(([k, n]) => `<a href="/p/${encodeURIComponent(id)}${k === 'resume' ? '' : '/' + k}" class="${k === tab ? 'on' : ''}">${t(n)}</a>`).join('')}</nav></div>`;
  if (tab === 'chances') return h + chancesPage(d, c, o);
  if (tab === 'collection') return h + collectionPage(id, d, c);
  if (tab === 'parties') return h + section(t('hisGames'), pager('pgames', d.games, 20, gamesTable), `<span class="mut">${t('nGames', { n: d.games.length })}</span>`);

  const sp = d.split;
  h += `<section class="tiles">
    ${tile(N(p.chests), t('pAll'), 'hero')}
    ${tile(N(sp.groupChests), t('pGroup', { n: sp.groupGames, t: N(sp.groupTeamChests) }))}
    ${tile(N(sp.otherChests), t('pOther', { n: sp.otherGames }))}
    ${tile(N(p.matches), t('pMatches', { a: dec(p.average), b: N(p.best) }))}
    ${tile('★ ' + N(p.treasures), t('pTreasures'))}
    ${tile(N(p.wins), t('pTop', { n: p.eliminations }))}</section>`;
  const outfit = d.chances?.odds.find(x => x.kind === 'outfit');
  if (outfit) h += `<a class="card chancelink" href="/p/${encodeURIComponent(id)}/chances"><span>${t('outfitLink', { p: pct(outfit.chance) })}</span><span>${t('seeChances')}</span></a>`;
  if (d.lineups.length) h += section(t('hisGroups'), lineupsTable(d.lineups), `<span class="mut">${t('hisGroupsSub')}</span>`);
  h += section(t('lastGames'), gamesTable(d.games.slice(0, 6)), `<a href="/p/${encodeURIComponent(id)}/parties">${t('allHisGames')}</a>`);
  const kinds = Object.entries(d.chestKinds).sort((a, b) => b[1] - a[1]);
  const kmax = Math.max(1, ...kinds.map(k => k[1]));
  h += `<div class="cols">` + section(t('chestKinds'), `<div class="card">${kinds.length ? '<table><tbody>' + kinds.map(([k, n]) => `<tr><td>${esc(k)}</td><td class="n num big" style="width:60px">${N(n)}</td><td style="width:45%"><span class="meter"><i style="width:${n / kmax * 100}%"></i></span></td></tr>`).join('') + '</tbody></table>' : '<p class="empty">—</p>'}</div>`)
    + section(t('treasuresFound'), `<div class="card">${d.treasures.length ? '<table><tbody>' + d.treasures.map(x => `<tr><td class="num nw">${when(x.startUtc)}</td><td>★ ${esc(x.name || t('unknownTreasure'))}</td></tr>`).join('') + '</tbody></table>' : `<p class="empty">${t('noTreasure')}</p>`}</div>`) + '</div>';
  const obs = location.origin + '/overlay/' + encodeURIComponent(id) + '?' + new URLSearchParams({ lang: LANG, ...(KEY ? { k: KEY } : {}) });
  h += section(t('obs'), `<div class="card"><p style="margin-top:0">${t('obsHelp')}</p>
    <div class="copy"><code>${esc(obs)}</code><button data-copy="${esc(obs)}">${t('copy')}</button><a class="btn" href="${esc(obs)}" target="_blank" rel="noopener">${t('preview')}</a></div></div>`);
  return h;
}

// --- Groupes ------------------------------------------------------------------------------------------------------

function lineupsTable(lineups) {
  return `<div class="card"><table><thead><tr><th>${t('colGroup')}</th><th class="n">${t('colGames')}</th><th class="n">${t('colChests')}</th><th class="n">${t('colAverage')}</th><th class="n hide-sm">${t('colBest')}</th><th class="n hide-sm">${t('colTop1')}</th><th class="hide-sm">${t('colLastShort')}</th></tr></thead><tbody>` +
    lineups.map(g => `<tr><td>${g.lineup.map((id, i) => playerLink(id, g.names[i])).join(' · ')}</td><td class="n num">${N(g.games)}</td><td class="n num big">${N(g.chests)}${g.complete < g.games ? `<span class="mut" title="${esc(t('partialGroups'))}">+</span>` : ''}</td><td class="n num">${dec(g.average)}</td><td class="n num hide-sm">${N(g.best)}</td><td class="n num hide-sm">${N(g.wins)}</td><td class="num hide-sm nw">${when(g.lastUtc)}</td></tr>`).join('') +
    '</tbody></table></div>';
}

function groupsPage(g) {
  const s = g.totals;
  if (!s.games) return section(t('tabGroups'), `<div class="card"><p class="empty">${t('noGroupGames')} ${t('groupRule')}</p></div>`);
  let h = `<section class="tiles">
    ${tile(N(s.games), t('gGames'), 'hero')}
    ${tile(N(s.chests), t('gChests'))}
    ${tile(dec(s.average), t('gAverage'))}
    ${tile(N(s.best), t('gBest'))}
    ${tile(N(s.wins), t('gWins'))}
    ${tile(N(s.complete) + ' / ' + N(s.games), t('gComplete'))}</section>`;
  h += `<p class="note">${t('groupRule')} ${t('groupNote')}</p>`;
  h += section(t('theGroups'), lineupsTable(g.lineups), `<span class="mut">${t('theGroupsSub')}</span>`);
  h += section(t('groupPlayers'), `<div class="card"><table><thead><tr><th>${t('colPlayer')}</th><th class="n">${t('colGroupGames')}</th><th class="n">${t('colGroupChests')}</th><th class="n">${t('colAverage')}</th></tr></thead><tbody>` +
    g.players.map(p => `<tr><td>${playerLink(p.epicId, p.name)}</td><td class="n num">${N(p.games)}${p.sent < p.games ? ` <span class="mut" title="${esc(t('notSentTip'))}">${t('notSent', { n: p.games - p.sent })}</span>` : ''}</td><td class="n num big">${N(p.chests)}</td><td class="n num">${dec(p.average)}</td></tr>`).join('') +
    '</tbody></table></div>');
  h += section(t('lastGroupGames'), gamesTable(g.games), `<a href="/parties?vue=groupe">${t('allGroupGames')}</a>`);
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
  const filters = `<div class="filters"><a class="chip ${scope === 'all' ? 'on' : ''}" href="${link('', who, 1)}">${t('all')}</a><a class="chip ${scope === 'group' ? 'on' : ''}" href="${link('groupe', who, 1)}">${t('inGroup')}</a>
    <select id="gamesWho" aria-label="${esc(t('colPlayer'))}"><option value="">${t('allPlayers')}</option>${o.players.map(p => `<option value="${esc(p.epicId)}" ${p.epicId === who ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
  const off = 'aria-disabled="true" style="pointer-events:none;opacity:.4"';
  const nav = pages > 1 ? `<div class="pager"><a class="btn" href="${link(q.get('vue'), who, page)}" ${page === 0 ? off : ''}>←</a><span class="num">${page + 1} / ${pages}</span><a class="btn" href="${link(q.get('vue'), who, page + 2)}" ${page >= pages - 1 ? off : ''}>→</a></div>` : '';
  return section(scope === 'group' ? t('groupGames') : t('allGames'), filters + gamesTable(d.games) + nav, `<span class="mut">${t('nGames', { n: d.total })}</span>`);
}

// --- Partie -------------------------------------------------------------------------------------------------------

async function gamePage(id) {
  const d = await api('/api/games/' + encodeURIComponent(id));
  const t0 = d.teams[0];
  // Several teams of the group can be in the same match (friends in different squads): one card each.
  return `<div class="phead"><h1 class="pirate">${t('matchOf', { d: when(t0.startUtc, true) })}</h1></div>` + d.teams.map(x => `<div class="card">
    <div class="gsum"><span class="num gbig">${N(x.teamChests)}${x.complete ? '' : '+'}</span><span class="mut">${t('teamChests')}</span>
      <span>${esc(mode(x.playlist))}</span><span class="num">${place(x)}</span>${x.durationSeconds ? `<span class="mut num">${t('minutes', { n: Math.round(x.durationSeconds / 60) })}</span>` : ''}${status(x)}</div>
    <table><thead><tr><th>${t('colPlayer')}</th><th class="n">${t('colChests')}</th><th class="n">${t('colDestroyed')}</th><th class="n hide-sm">${t('colElims')}</th><th class="n">${t('colTreasures')}</th></tr></thead><tbody>
    ${x.members.map(m => `<tr><td>${playerLink(m.epicId, memberName(m))}</td>${m.chests == null ? `<td class="n mut" colspan="4">${t('didNotSend')}</td>` : `<td class="n num big">${N(m.chests)}</td><td class="n num">${N(m.destroyed)}</td><td class="n num hide-sm">${N(m.eliminations)}</td><td class="n num">★ ${N(m.treasures)}</td>`}</tr>`).join('')}
    ${x.bots ? `<tr><td class="mut" colspan="5">${t('botsNotCounted', { n: x.bots })}</td></tr>` : ''}
    </tbody></table>
    ${x.issues.length ? `<ul class="issues">${x.issues.map(i => `<li>${esc(issueText(i))}</li>`).join('')}</ul>` : ''}
    <p class="mut small">${t('matchId')}<span class="num">${esc(x.sessionId)}</span></p></div>`).join('');
}

// --- Aide ---------------------------------------------------------------------------------------------------------

function helpPage() {
  const site = esc(location.origin);
  const cmds = ['show', 'rotate group', 'rotate view', 'clear view'];
  const notes = t('hHostCmds').split('\n');
  const pre = cmds.map((c, i) => `docker compose exec chests python -m app.admin ${c}`.padEnd(66) + (notes[i] || '')).join('\n');
  return section(t('hJoin'), `<div class="card prose"><ol><li>${t('hJoin1')}</li><li>${t('hJoin2')}</li><li>${t('hJoin3', { site })}</li><li>${t('hJoin4')}</li></ol></div>`)
    + section(t('hServer'), `<div class="card prose"><p>${t('hServer1')}</p><p>${t('hServer2')}</p></div>`)
    + section(t('hHow'), `<div class="card prose"><p>${t('hHow1')}</p><p>${t('hHow2')}</p><p>${t('hHow3')}</p></div>`)
    + section(t('hObs'), `<div class="card prose"><p>${t('hObs1')}</p></div>`)
    + section(t('hHost'), `<div class="card prose"><p>${t('hHost1')}</p><pre>${esc(pre)}</pre><p>${t('hHost2')}</p></div>`);
}

// --- events -------------------------------------------------------------------------------------------------------

document.addEventListener('click', e => {
  const copy = e.target.closest('[data-copy]');
  if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); copy.textContent = t('copied'); return; }
  const step = e.target.closest('.pager button');
  if (step) {
    const box = document.getElementById(step.parentElement.dataset.for);
    const page = Math.min(Math.max(0, +box.dataset.page + +step.dataset.step), +box.dataset.pages - 1);
    box.dataset.page = page;
    const source = cache['p:' + route().id].data.games;
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
  if (e.target.id === 'lang') { setLang(e.target.value); render(false); return; }
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
