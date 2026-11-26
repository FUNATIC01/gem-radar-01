// Token Radar dashboard: static, no network. All data comes from window.RADAR
// (data.js, written by main.ts from the same board.json). Hash routes:
//   #/                          board (filters live in the hash query)
//   #/protocol/<slug>          one protocol: implied band, peers, farm plan
//   #/sectors                   category aggregates
//   #/compare[?a=<slug>&b=<slug>]  two protocols side by side
//   #/live                      live-token protocols the model prices off
//   #/method                    the model, its constants and its backtest
'use strict';
var D = window.RADAR || { rows: [], live: [], sectors: [], backtest: {} };
var app = document.getElementById('app');
var WATCHLIST = new Set(D.rows.filter(function (r) { return r.watch; }).map(function (r) { return r.slug; }));

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function money(n) {
  if (n == null) return '—';
  if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'b';
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'm';
  if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
  return '$' + Math.round(n);
}
function pct(v) { return v == null ? 'n/a' : (v >= 0 ? '+' : '') + v + '%'; }
function pctCls(v) { return v == null ? '' : (v >= 0 ? 'up' : 'dn'); }
function ageText(r) { return r.age_days == null ? 'unknown' : r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + 'y' : r.age_days + 'd'; }
function catName(r) { return r.category || 'Uncategorised'; }
function parseHash() {
  var h = location.hash.replace(/^#\/?/, '');
  var parts = h.split('?');
  var path = parts[0] || '';
  var q = {};
  (parts[1] || '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) q[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); });
  return { path: path, q: q };
}
function hashFor(path, q) {
  var s = Object.keys(q || {}).filter(function (k) { return q[k] !== '' && q[k] != null; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
  return '#/' + path + (s ? '?' + s : '');
}
function setNav(name) { document.querySelectorAll('.nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.nav === name); }); }
function bandBar(r) {
  var lo = Math.log10(Math.max(1, r.implied_low_usd)), hi = Math.log10(Math.max(1, r.implied_high_usd)), v = Math.log10(Math.max(1, r.implied_value_usd));
  var span = Math.max(hi - lo, 0.01);
  var left = 0, width = 100, mark = ((v - lo) / span) * 100;
  return '<div class="bandbar"><i style="left:' + left + '%;width:' + width + '%"></i><b style="left:' + mark.toFixed(1) + '%"></b></div>';
}
function rowLink(r) { return '#/protocol/' + encodeURIComponent(r.slug); }

function boardView(q) {
  setNav('board');
  var cats = [], chains = [];
  D.rows.forEach(function (r) { if (cats.indexOf(catName(r)) < 0) cats.push(catName(r)); if (r.chains) r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); }); });
  cats.sort(); chains.sort();
  var f = { q: (q.q || '').toLowerCase(), cat: q.cat || '', chain: q.chain || '', min: +(q.min || 0), watch: q.watch === '1', sort: q.sort || 'implied' };
  var rows = D.rows.filter(function (r) {
    if (f.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(f.q) < 0) return false;
    if (f.cat && catName(r) !== f.cat) return false;
    if (f.chain && !(r.chains || []).includes(f.chain)) return false;
    if (f.min && r.tvl_usd < f.min) return false;
    if (f.watch && !WATCHLIST.has(r.slug)) return false;
    return true;
  });
  var sorts = {
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    growth: function (a, b) { return (b.change_7d == null ? -999 : b.change_7d) - (a.change_7d == null ? -999 : a.change_7d); },
    age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
    name: function (a, b) { return a.name.localeCompare(b.name); }
  };
  rows.sort(sorts[f.sort] || sorts.implied);
  var bt = D.backtest || {};
  var html = '<div class="stats">'
    + '<div class="stat"><b>' + D.board_size + '</b><span>protocols ranked · ' + D.watchlist_size + ' watchlist</span></div>'
    + '<div class="stat"><b>' + money(D.rows[0] ? D.rows[0].implied_value_usd : 0) + '</b><span>top implied value · ' + esc(D.rows[0] ? D.rows[0].name : '') + '</span></div>'
    + '<div class="stat"><b>' + (bt.median_abs_error_pct != null ? bt.median_abs_error_pct + '%' : '—') + '</b><span>backtest median error (n=' + (bt.n || 0) + ')</span></div>'
    + '<div class="stat"><b>' + (bt.band_coverage_pct != null ? bt.band_coverage_pct + '%' : '—') + '</b><span>of live caps inside the band</span></div></div>'
    + '<div class="card"><h2>The board</h2><p class="sub">Pre-token protocols ranked by implied value — TVL priced off the live-token peers in the same snapshot. “Records no token” means the snapshot records none. Click a row for its detail, peers and farm plan.</p>'
    + '<div class="controls">'
    + '<div class="grow"><label>Search name</label><input id="f-q" type="search" value="' + esc(q.q || '') + '" placeholder="e.g. symbiotic"></div>'
    + '<div><label>Category</label><select id="f-cat"><option value="">All</option>' + cats.map(function (c) { return '<option' + (f.cat === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>'
    + '<div><label>Chain</label><select id="f-chain"><option value="">All</option>' + chains.map(function (c) { return '<option' + (f.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>'
    + '<div><label>Min TVL</label><select id="f-min"><option value="0">Any</option>' + [5000000, 50000000, 100000000, 1000000000].map(function (v) { return '<option value="' + v + '"' + (f.min === v ? ' selected' : '') + '>' + money(v) + '</option>'; }).join('') + '</select></div>'
    + '<div><label>Sort by</label><select id="f-sort">' + [['implied', 'Implied value'], ['tvl', 'TVL'], ['growth', '7-day growth'], ['age', 'Age'], ['name', 'Name']].map(function (o) { return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>'
    + '<div><label>&nbsp;</label><button id="f-watch" class="' + (f.watch ? '' : 'ghost') + '">' + (f.watch ? '★ Watchlist only' : 'Watchlist only') + '</button></div>'
    + '</div><p class="small">' + rows.length + ' of ' + D.rows.length + ' rows shown · <a href="#/method">how the value is priced</a></p>'
    + '<div style="overflow-x:auto"><table><thead><tr><th>#</th><th>Protocol</th><th>Category</th><th>TVL</th><th>7d</th><th>Implied FDV</th><th>Band low – high</th><th>Age</th></tr></thead><tbody>'
    + rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + r.rank + '</td>' + '<td><b>' + esc(r.name) + '</b> ' + (WATCHLIST.has(r.slug) ? '<span class="watch" title="On the snapshot watchlist">\u25cf</span>' : '') + '<br><span class="small">' + esc(r.slug) + '</span></td>' + '<td>' + esc(catName(r)) + '<br><span class="small">' + esc((r.chains || []).slice(0, 3).join(', ')) + '</span></td>' + '<td class="num">' + money(r.tvl_usd) + '</td>' + '<td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td>' + '<td class="num"><b>' + money(r.implied_value_usd) + '</b>' + bandBar(r) + '</td>' + '<td class="num">' + money(r.implied_low_usd) + ' \u2013 ' + money(r.implied_high_usd) + '<br><span class="small">\u00d7' + r.multiple + ' (' + (r.peer_global ? 'global median' : r.peer_count + ' peers') + ')</span></td>' + '<td class="num">' + ageText(r) + '</td></tr>';
    }).join('') + '</tbody></table></div></div>';
  app.innerHTML = html;
  function apply() {
    var nq = { q: document.getElementById('f-q').value, cat: document.getElementById('f-cat').value, chain: document.getElementById('f-chain').value, min: document.getElementById('f-min').value, sort: document.getElementById('f-sort').value, watch: f.watch ? '1' : '' };
    if (nq.min === '0') nq.min = '';
    location.hash = hashFor('', nq);
  }
  ['f-q', 'f-cat', 'f-chain', 'f-min', 'f-sort'].forEach(function (id) { document.getElementById(id).addEventListener('change', apply); });
  document.getElementById('f-q').addEventListener('input', function () { clearTimeout(window.__t); window.__t = setTimeout(apply, 400); });
  document.getElementById('f-watch').addEventListener('click', function () { f.watch = !f.watch; apply(); });
  app.querySelectorAll('tbody tr').forEach(function (tr) { tr.addEventListener('click', function () { location.hash = rowLink({ slug: tr.dataset.slug }); }); });
}

function detailView(slug) {
  setNav('board');
  var r = D.rows.find(function (x) { return x.slug === slug; });
  if (!r) { app.innerHTML = '<div class="card"><h2>Not on the board</h2><p>No ranked protocol has the slug “' + esc(slug) + '”. <a href="#/">Back to the board</a>.</p></div>'; return; }
  var peers = (r.peers || []).map(function (p) {
    return '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">×' + p.multiple + '</td></tr>';
  }).join('');
  app.innerHTML = '<div class="card"><p class="small"><a href="#/">← Board</a> · rank #' + r.rank + ' of ' + D.board_size + (WATCHLIST.has(r.slug) ? ' · <span class="watch">● on the watchlist</span>' : '') + '</p>'
    + '<h2>' + esc(r.name) + '</h2><p class="sub">' + esc(catName(r)) + ' · ' + esc((r.chains || []).join(', ') || 'no chain listed') + ' · records no token</p>'
    + '<div class="kv"><div><b>' + money(r.implied_value_usd) + '</b><span>implied value (base case)</span></div>'
    + '<div><b>' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</b><span>confidence band (peer quartiles)</span></div>'
    + '<div><b>×' + r.multiple + '</b><span>peer median multiple' + (r.peer_global ? ' (global — too few same-category peers)' : ' (' + r.peer_count + ' same-category peers)') + '</span></div>'
    + '<div><b>' + money(r.tvl_usd) + '</b><span>TVL</span></div>'
    + '<div><b class="' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</b><span>TVL change, 7 days</span></div>'
    + '<div><b>' + ageText(r) + '</b><span>tracked since ' + esc(r.listed_at || 'unknown') + '</span></div></div>'
    + '<h3>How the number is built</h3><p>TVL ' + money(r.tvl_usd) + ' × peer median ×' + r.multiple + ' × growth ×' + r.growth_multiplier + ' × maturity ×' + r.maturity_multiplier + ' × breadth ×' + r.breadth_multiplier + ' = <b>' + money(r.implied_value_usd) + '</b>. The band swaps the median for the peers’ first and third quartile multiples (×' + r.multiple_low + ' – ×' + r.multiple_high + '). Market cap stands in for fully-diluted value because the snapshot carries no FDV — read the band, not just the point.</p>'
    + '<h3>Closest live peers in ' + esc(catName(r)) + '</h3>'
    + (peers ? '<table><thead><tr><th>Peer (already trading)</th><th>TVL</th><th>Market cap</th><th>Multiple</th></tr></thead><tbody>' + peers + '</tbody></table>' : '<p class="small">No same-category live peer in this snapshot.</p>')
    + '<h3>Farm plan — 7 steps</h3><ol class="farm">' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
    + '<p class="small">Compare: <a href="#/compare?a=' + encodeURIComponent(r.slug) + '">compare ' + esc(r.name) + ' with another protocol</a> · snapshot ' + esc(D.as_of) + '</p></div>';
}

function sectorsView() {
  setNav('sectors');
  app.innerHTML = '<div class="card"><h2>Sectors</h2><p class="sub">Board rows grouped by category. The median implied value is the sector’s middle protocol — a sector with a high median and many rows is where the launch value concentrates.</p><div class="sectors">'
    + D.sectors.map(function (s) {
      return '<div class="sector" data-cat="' + esc(s.category) + '"><h3>' + esc(s.category) + '</h3><b>' + money(s.median_implied_usd) + '</b><p>median implied value · ' + s.rows + ' rows</p><p>Total TVL ' + money(s.total_tvl_usd) + ' · top: ' + esc(s.top_name) + '</p></div>';
    }).join('') + '</div></div>';
  app.querySelectorAll('.sector').forEach(function (el) { el.addEventListener('click', function () { location.hash = hashFor('', { cat: el.dataset.cat }); }); });
}

function compareView(q) {
  setNav('compare');
  var opts = D.rows.map(function (r) { return '<option value="' + esc(r.slug) + '">' + esc(r.name) + ' (' + money(r.implied_value_usd) + ')</option>'; }).join('');
  var a = D.rows.find(function (r) { return r.slug === (q.a || D.rows[0].slug); }) || D.rows[0];
  var b = D.rows.find(function (r) { return r.slug === (q.b || D.rows[1].slug); }) || D.rows[1];
  function col(r) {
    return '<td><b>' + esc(r.name) + '</b><br><span class="small">rank #' + r.rank + ' · ' + esc(catName(r)) + '</span></td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.implied_value_usd) + '</td><td class="num">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</td><td class="num">×' + r.multiple + '</td><td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td><td class="num">' + ageText(r) + '</td><td class="num">' + esc((r.chains || []).length + ' chains') + '</td>';
  }
  app.innerHTML = '<div class="card"><h2>Compare two protocols</h2><p class="sub">Same model, same snapshot, side by side. The wider band is the less certain bet.</p>'
    + '<div class="grid2"><div><label>Protocol A</label><select class="cmp" id="cmp-a">' + opts + '</select></div><div><label>Protocol B</label><select class="cmp" id="cmp-b">' + opts + '</select></div></div>'
    + '<div style="overflow-x:auto;margin-top:14px"><table><thead><tr><th>Protocol</th><th>TVL</th><th>Implied</th><th>Band</th><th>Multiple</th><th>7d</th><th>Age</th><th>Chains</th></tr></thead><tbody><tr>' + col(a) + '</tr><tr>' + col(b) + '</tr></tbody></table></div>'
    + '<h3>Farm plan — ' + esc(a.name) + '</h3><ol class="farm">' + a.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
    + '<h3>Farm plan — ' + esc(b.name) + '</h3><ol class="farm">' + b.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></div>';
  document.getElementById('cmp-a').value = a.slug;
  document.getElementById('cmp-b').value = b.slug;
  function go() { location.hash = '#/compare?a=' + encodeURIComponent(document.getElementById('cmp-a').value) + '&b=' + encodeURIComponent(document.getElementById('cmp-b').value); }
  document.getElementById('cmp-a').addEventListener('change', go);
  document.getElementById('cmp-b').addEventListener('change', go);
}

function liveView() {
  setNav('live');
  app.innerHTML = '<div class="card"><h2>Live tokens — the price reference</h2><p class="sub">The ' + D.live_size + ' largest live-token protocols by market cap. Their market-cap / TVL multiples are the peers the model prices pre-token protocols off. They are not ranked here: the market already priced them.</p>'
    + '<table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>Multiple</th><th>7d</th></tr></thead><tbody>'
    + D.live.map(function (r) { return '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(catName(r)) + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td><td class="num">×' + (r.multiple == null ? '—' : r.multiple) + '</td><td class="num ' + pctCls(r.change_7d) + '">' + pct(r.change_7d) + '</td></tr>'; }).join('')
    + '</tbody></table></div>';
}

function methodView() {
  setNav('method');
  var bt = D.backtest || {};
  var m = D.model || {};
  app.innerHTML = '<div class="card"><h2>Method — model radar-4</h2>'
    + '<p><b>Implied value = TVL × category-median peer multiple × growth × maturity × breadth.</b> Peers are the live-token protocols in the same snapshot, in the same category (at least ' + (m.min_peers || 5) + ' peers, else the global median). The band uses the peers’ first and third quartile multiples with the same adjustments.</p>'
    + '<pre>growth   = 1 + clamp(change_7d, ' + (m.growth_floor || -60) + ', ' + (m.growth_cap || 120) + ') / 100 × ' + (m.growth_weight || 0.4) + '   (null change counts as 0)\nmaturity = ' + (m.maturity_floor || 0.85) + ' + min(age_days, ' + (m.maturity_days || 1095) + ') / ' + (m.maturity_days || 1095) + ' × ' + (m.maturity_range || 0.3) + '   (unknown age counts as ' + (m.unknown_age_days || 365) + ' days)\nbreadth  = 1 + min(chains − 1, ' + (m.breadth_cap_chains || 4) + ') × ' + (m.breadth_step || 0.03) + '</pre>'
    + '<h3>Backtest — the calibration, as measured</h3>'
    + '<p>' + esc(bt.method || '') + '</p>'
    + '<div class="kv"><div><b>' + (bt.n || 0) + '</b><span>live protocols backtested</span></div><div><b>' + (bt.median_abs_error_pct != null ? bt.median_abs_error_pct + '%' : '—') + '</b><span>median absolute error</span></div><div><b>' + (bt.median_signed_error_pct != null ? (bt.median_signed_error_pct >= 0 ? '+' : '') + bt.median_signed_error_pct + '%' : '—') + '</b><span>median signed error (bias)</span></div><div><b>' + (bt.band_coverage_pct != null ? bt.band_coverage_pct + '%' : '—') + '</b><span>actual caps inside the band</span></div></div>'
    + '<div class="warn"><b>Read this before trusting a number.</b> Peer multiples spread from ×' + (bt.peer_multiple_p25 != null ? bt.peer_multiple_p25 : '—') + ' (first quartile) to ×' + (bt.peer_multiple_p75 != null ? bt.peer_multiple_p75 : '—') + ' (third quartile) — about 25×. That is why the median error is near 90%: the model gets the order of magnitude and the ranking right far more often than the dollar figure. The band is the honest signal; the point estimate is a ranking device, not a price target. Market cap stands in for fully-diluted value because the snapshot carries no FDV.</div>'
    + '<h3>What the board covers</h3><p>' + D.board_size + ' rows: all ' + D.watchlist_size + ' watchlist protocols (TVL ≥ ' + money(D.floor_usd) + ', records no token) plus ' + D.early_size + ' early pre-token protocols below the floor, ranked by implied value. Exchanges, bridges, liquid-staking products and versioned pools are not ranked as launches. Twenty more pre-token protocols sit above the floor but are not ranked: the house watchlist leaves them off, and each reads as a product line of a larger protocol (regional, perps, spot, vault or wrapper), so ranking it as a separate launch would double-count its parent. Snapshot ' + esc(D.as_of) + ' · source: ' + esc(D.source || '') + '.</p></div>';
}

function route() {
  var h = parseHash();
  var path = h.path;
  if (path === '' || path === '/') boardView(h.q);
  else if (path.indexOf('protocol/') === 0) detailView(decodeURIComponent(path.slice(9)));
  else if (path === 'sectors') sectorsView();
  else if (path === 'compare') compareView(h.q);
  else if (path === 'live') liveView();
  else if (path === 'method') methodView();
  else boardView(h.q);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();
