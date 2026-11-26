/* Token Launch Radar — dashboard. Reads window.RADAR (data.js), no fetch, no network. */
(function () {
  var D = window.RADAR;
  var view = document.getElementById('view');
  var nav = document.getElementById('nav');
  var state = { sort: 'rank', dir: 1, q: '', cat: '', grp: '', watch: false, slug: null };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'b';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'k';
    return '$' + Math.round(n);
  }
  function pct(n) { return n == null ? '—' : (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function age(a) { return a == null ? '—' : a + 'd'; }
  function bySlug(s) { for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === s) return D.rows[i]; return null; }
  function opt(list, cur, label) {
    var h = '<option value="">' + label + '</option>';
    list.forEach(function (v) { h += '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'; });
    return h;
  }
  document.getElementById('meta').textContent = 'Snapshot ' + D.as_of + ' · ' + D.source + ' · floor ' + money(D.floor_usd) + ' · ' + D.board_size + ' rankable pre-token protocols (' + D.watchlist_size + ' watchlist, ' + D.early_size + ' above or below the floor) · model ' + D.model_version;
  var b = D.backtest;
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + b.median_abs_error_pct + '%</b><span>median abs error, leave-one-out, n=' + b.n + '</span></div>' +
    '<div class="stat"><b>' + b.band_coverage_pct + '%</b><span>of actual caps inside the 20–80 band</span></div>' +
    '<div class="stat"><b>' + b.spearman + '</b><span>Spearman, predicted vs actual cap</span></div>' +
    '<div class="stat"><b><em>' + b.radar4_median_abs_error_pct + '%</em></b><span>radar-4 median abs error, same loop</span></div>';

  function sortRows(rows) {
    var k = state.sort, d = state.dir;
    return rows.slice().sort(function (a, c) {
      var x = a[k], y = c[k];
      if (x == null) return 1; if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * d;
    });
  }
  function th(label, key) {
    var arrow = state.sort === key ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return '<th data-k="' + key + '"' + (key === 'implied_value_usd' || key === 'tvl_usd' ? ' class="num"' : '') + '>' + label + arrow + '</th>';
  }
  function renderBoard() {
    var cats = [], grps = [];
    D.rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
      if (grps.indexOf(r.group) < 0) grps.push(r.group);
    });
    cats.sort(); grps.sort();
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watch) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.grp && r.group !== state.grp) return false;
      if (state.q) {
        var q = state.q.toLowerCase();
        if ((r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      }
      return true;
    });
    rows = sortRows(rows);
    var h = '<h2>Board — ' + rows.length + ' of ' + D.rows.length + ' protocols</h2>' +
      '<p class="note">Implied value is an order of magnitude, not a price target: the median backtest error is ' + b.median_abs_error_pct + '%. Rank by implied value; check the band before acting on any row.</p>' +
      '<div class="filters"><input id="fq" type="search" placeholder="Search name or slug" value="' + esc(state.q) + '">' +
      '<select id="fc">' + opt(cats, state.cat, 'All categories') + '</select>' +
      '<select id="fg">' + opt(grps, state.grp, 'All groups') + '</select>' +
      '<label><input id="fw" type="checkbox"' + (state.watch ? ' checked' : '') + '> Watchlist only</label></div>' +
      '<table><thead><tr>' + th('#', 'rank') + th('Protocol', 'name') + th('Category', 'category') + th('Chains', 'primary_chain') + th('TVL', 'tvl_usd') + th('7d', 'change_7d') + th('Implied', 'implied_value_usd') + th('Band', 'implied_low_usd') + th('×TVL', 'multiple') + th('Age', 'age_days') + '<th>Watch</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      h += '<tr data-slug="' + esc(r.slug) + '"><td class="rank">' + r.rank + '</td><td><b>' + esc(r.name) + '</b><br><span class="note">' + esc(r.slug) + '</span></td><td>' + esc(r.category || '—') + '</td><td>' + esc(r.primary_chain) + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + pct(r.change_7d) + '</td><td class="num"><b>' + money(r.implied_value_usd) + '</b></td><td class="num">' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + '</td><td class="num">' + r.multiple + '×</td><td class="num">' + age(r.age_days) + '</td><td>' + (r.watch ? '<span class="watch">● watch</span>' : '') + '</td></tr>';
    });
    view.innerHTML = h + '</tbody></table>';
    document.getElementById('fq').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); var f = document.getElementById('fq'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); });
    document.getElementById('fc').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
    document.getElementById('fg').addEventListener('change', function (e) { state.grp = e.target.value; renderBoard(); });
    document.getElementById('fw').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
    view.querySelectorAll('th[data-k]').forEach(function (el) {
      el.addEventListener('click', function () {
        var k = el.getAttribute('data-k');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
        renderBoard();
      });
    });
    view.querySelectorAll('tr[data-slug]').forEach(function (el) {
      el.addEventListener('click', function () { location.hash = '#/detail/' + el.getAttribute('data-slug'); });
    });
  }
  function renderDetail() {
    var r = bySlug(state.slug) || D.rows[0];
    var span = Math.log(r.implied_high_usd) - Math.log(Math.max(1, r.implied_low_usd));
    var pos = span <= 0 ? 50 : (Math.log(r.implied_value_usd) - Math.log(Math.max(1, r.implied_low_usd))) / span * 100;
    var h = '<h2>' + esc(r.name) + ' <span class="pill">rank #' + r.rank + '</span> ' + (r.watch ? '<span class="pill watch">watchlist</span>' : '') + '</h2>' +
      '<div class="card"><p><b>Category:</b> ' + esc(r.category || '—') + ' · <b>Group:</b> ' + esc(r.group) + ' · <b>Chains:</b> ' + r.chains.map(esc).join(', ') + ' · <b>TVL:</b> ' + money(r.tvl_usd) + ' · <b>7-day:</b> ' + pct(r.change_7d) + ' · <b>Age:</b> ' + age(r.age_days) + '</p>' +
      '<p class="big">Implied value ' + money(r.implied_value_usd) + ' <span class="note">(' + r.multiple + '× TVL)</span></p>' +
      '<div class="band"><i style="left:0;width:100%"></i><b style="left:' + pos.toFixed(1) + '%"></b></div>' +
      '<p class="note">Band ' + money(r.implied_low_usd) + ' – ' + money(r.implied_high_usd) + ' (' + r.multiple_low + '× – ' + r.multiple_high + '× TVL): the central 60% of what the peers\' own errors look like. On the backtest it held the actual cap ' + b.band_coverage_pct + '% of the time.</p>' +
      '<p class="note">Model for this row: log cap = ' + r.intercept + ' + ' + r.slope + ' × log TVL, group correction ' + (r.group_correction >= 0 ? '+' : '') + r.group_correction + ' (' + esc(r.group) + '), chain correction ' + (r.chain_correction >= 0 ? '+' : '') + r.chain_correction + ' (' + esc(r.primary_chain) + '), from ' + r.peer_count + ' live peers. Seven-day growth, age and chain count are not priced: the backtest found them to be noise.</p></div>' +
      '<div class="card"><h3>Closest live peers in ' + esc(r.category || 'its category') + '</h3><table><thead><tr><th>Peer</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">×TVL</th></tr></thead><tbody>';
    r.peers.forEach(function (p) { h += '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.multiple + '×</td></tr>'; });
    h += '</tbody></table></div><div class="card"><h3>Farm plan — 7 steps</h3><ol class="steps">';
    r.farm_steps.forEach(function (s) { h += '<li>' + esc(s) + '</li>'; });
    h += '</ol><p class="note">Every step carries its cost and time. The plan is a starting point, not advice: a token may never launch, and a farmed allocation can be worth nothing.</p></div>';
    view.innerHTML = h;
  }
  function renderMethod() {
    view.innerHTML = '<h2>Method</h2>' +
      '<div class="card"><h3>The model</h3><p>Implied value = exp(Huber intercept + slope × log TVL + group correction + chain correction). The fit is a Huber regression (k = ' + D.model.huber_k + ', ' + D.model.huber_rounds + ' rounds, MAD scale) of log market cap on log TVL over the ' + b.n + ' live-token protocols in the snapshot — not an exchange, positive market cap. The slope is near 0.4, not 1.0: a market cap does not grow one-for-one with TVL. The two corrections are shrunk means of the fit\'s residuals for the protocol\'s business group (7 groups folded from DefiLlama\'s categories) and its primary chain, each pulled toward zero with τ = ' + D.model.tau_group + ', because most groups and chains have few live peers.</p>' +
      '<p>Seven-day TVL growth, listing age and chain count are <b>not</b> priced. Each correlates with the log residual at |r| &lt; 0.1, and radar-4\'s growth, maturity and breadth multipliers were measured to be noise — removing them alone moved radar-4\'s error from 91.9% to 90.5%.</p>' +
      '<p>The band is the point estimate times exp() of the 20th and 80th percentiles of the peer residuals, so it is the central 60% of the peers\' own errors.</p></div>' +
      '<div class="card"><h3>Backtest — leave-one-out, n = ' + b.n + '</h3><table><thead><tr><th>Metric</th><th class="num">Radar-5</th><th class="num">Radar-4</th></tr></thead><tbody>' +
      '<tr><td>Median absolute error</td><td class="num"><b>' + b.median_abs_error_pct + '%</b></td><td class="num">' + b.radar4_median_abs_error_pct + '%</td></tr>' +
      '<tr><td>Median signed error</td><td class="num">' + b.median_signed_error_pct + '%</td><td class="num">+5.6%</td></tr>' +
      '<tr><td>Band coverage</td><td class="num"><b>' + b.band_coverage_pct + '%</b></td><td class="num">38.7%</td></tr>' +
      '<tr><td>Spearman, predicted vs actual cap</td><td class="num"><b>' + b.spearman + '</b></td><td class="num">' + b.radar4_spearman + '</td></tr></tbody></table>' +
      '<p class="note">' + esc(b.method) + '</p></div>' +
      '<div class="card callout"><h3>Limits — read this first</h3><p>The peer multiples still spread over roughly two orders of magnitude inside a group, so even the best model on this snapshot has a median error of ' + b.median_abs_error_pct + '%: the point estimate is an order of magnitude, not a price target. Lending is the least predictable group in the backtest; RWA the most. The board is a ranking with a calibrated band, not a valuation. Nothing here uses a protocol\'s name, and no row is hand-picked.</p></div>' +
      '<div class="card"><h3>Who is on the board</h3><p>Every rankable pre-token protocol in the snapshot: the ' + D.watchlist_size + ' watchlist slugs, plus every other pre-token protocol that is not an exchange, not a wrapped, staked or bridged product and not a versioned pool — at any TVL. That is ' + D.board_size + ' rows. The $50m floor is a floor, never a ceiling: the snapshot\'s own documentation says a protocol the watchlist leaves out is no worse a subject than one on it. The ' + D.early_size + ' rows outside the watchlist include ' + D.rows.filter(function (r) { return !r.watch && r.tvl_usd >= D.floor_usd; }).length + ' above the floor. Radar-4 left those out on parentProtocol, a field the snapshot does not carry, so its exclusion cannot be checked from the snapshot.</p></div>';
  }
  function renderMarket() {
    var h = '<h2>Market — live tokens for comparison</h2><p class="note">The ' + D.live_size + ' largest live-token protocols by market cap (exchanges excluded), shown so the implied values can be checked against real ones. Their multiples are the peers the model learns from.</p><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">×TVL</th><th class="num">7d</th></tr></thead><tbody>';
    D.live.forEach(function (r) { h += '<tr><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.category || '—') + '</td><td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + money(r.mcap_usd) + '</td><td class="num">' + (r.multiple == null ? '—' : r.multiple + '×') + '</td><td class="num">' + pct(r.change_7d) + '</td></tr>'; });
    h += '</tbody></table><h3>Sectors on the board</h3><table><thead><tr><th>Category</th><th class="num">Rows</th><th class="num">Total TVL</th><th class="num">Median implied</th><th>Top</th></tr></thead><tbody>';
    D.sectors.forEach(function (s) { h += '<tr><td>' + esc(s.category) + '</td><td class="num">' + s.rows + '</td><td class="num">' + money(s.total_tvl_usd) + '</td><td class="num">' + money(s.median_implied_usd) + '</td><td>' + esc(s.top_name) + '</td></tr>'; });
    view.innerHTML = h + '</tbody></table>';
  }
  function route() {
    var raw = location.hash.replace(/^#\/?/, '');
    var qi = raw.indexOf('?');
    var query = qi >= 0 ? raw.slice(qi + 1) : '';
    var parts = (qi >= 0 ? raw.slice(0, qi) : raw).split('/');
    var v = parts[0] || 'board';
    nav.querySelectorAll('button').forEach(function (btn) { btn.classList.toggle('on', btn.getAttribute('data-view') === (v === 'detail' ? 'detail' : v)); });
    if (v === 'detail') { state.slug = parts[1] || null; renderDetail(); }
    else if (v === 'method') renderMethod();
    else if (v === 'market') renderMarket();
    else {
      query.split('&').forEach(function (kv) {
        var p = kv.split('=');
        if (p[0] === 'q') state.q = decodeURIComponent(p[1] || '');
        if (p[0] === 'cat') state.cat = decodeURIComponent(p[1] || '');
        if (p[0] === 'grp') state.grp = decodeURIComponent(p[1] || '');
        if (p[0] === 'watch') state.watch = p[1] === '1';
      });
      renderBoard();
    }
    window.scrollTo(0, 0);
  }
  nav.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-view]');
    if (!btn) return;
    var v = btn.getAttribute('data-view');
    location.hash = v === 'detail' && state.slug ? '#/detail/' + state.slug : '#/' + v;
  });
  window.addEventListener('hashchange', route);
  route();
})();
