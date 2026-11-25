// Token Radar radar-3 dashboard, rewritten. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, a filterable
// table, and a per-protocol detail drawer carrying the model's own inputs
// plus the protocol's farm plan. No network: every byte shown is in data.js.
// The page recomputes each row from the snapshot figures with the same
// radar-3 arithmetic main.ts uses, so the page's code and the board's data
// are visibly the same model — the detail drawer says so out loud, showing
// the recomputed figure next to the board's figure.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');

  // What the visitor is looking at right now: search text, filters, the
  // active tab, the sort, and the protocol whose detail drawer is open.
  var view = {
    query: '',
    category: 'all',
    chain: 'all',
    tab: 'pre-token',
    sort: 'implied',
    dir: -1,
    selected: null,
  };

  // The watchlist, as a set, so rows can wear their badge in O(1).
  var ON_WATCH = {};
  (DATA.watchlist || []).forEach(function (slug) { ON_WATCH[slug] = true; });

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  // A dollar figure, shortened past a thousand: $12.4M, $850K, $42.
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }

  // A per-cent figure with an explicit sign: +12.34%, -3.50%.
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  // An age in days, as years past a year: 2.4y, 87d, unknown.
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // radar-3, the same arithmetic lib/model.ts runs: base 2279.5453 x TVL^0.5,
  // growth clamped to -50..150 at weight 0.75, maturity 0.55 + min(age, 1460) / 1460
  // x 0.45 (unknown age 365), breadth 1 + min(chains - 1, 4) x 0.03.
  function recompute(row, model) {
    var weekly = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    var growth = Math.max(model.growth_floor, Math.min(model.growth_cap, weekly));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    var extra = Math.min(Math.max((row.chains || []).length - 1, 0), model.breadth_cap_chains);
    var breadth = 1 + extra * model.breadth_step;
    return Math.max(1, Math.round(model.power_scale * Math.pow(row.tvl_usd, model.power_exponent) * growthMult * maturity * breadth));
  }

  // Tiny element builder. Props: cls for className, txt for textContent,
  // html for innerHTML, on* for listeners, anything else for attributes.
  // Children may be strings, nodes, or arrays of either; nulls are skipped.
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var val = props[key];
        if (val === null || val === undefined) return;
        if (key === 'cls') node.className = val;
        else if (key === 'txt') node.textContent = val;
        else if (key === 'html') node.innerHTML = val;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), val);
        else node.setAttribute(key, val);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) { if (c) node.appendChild(c); });
      } else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // The farm plan is the same derivation main.ts writes to board.json:
  // category, chains, TVL and age decide the action, the capital, the hold
  // and every cost and time. No name is special-cased.
  function primaryChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondaryChain(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : null; }

  // Capital tiers, biggest TVL first: the first tier the TVL reaches wins.
  function stakeSize(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }

  function holdWindow(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }

  // Category playbook for the opening move: each entry names the category
  // words it answers. The first entry whose words appear in the lower-cased
  // category wins, so order is the priority; the wordless entry always wins.
  var OPENING_MOVES = [
    { words: ['lend', 'cdp', 'collateral'], move: function (cap, name, chain) { return 'Supply $' + cap + ' of USDC to ' + name + ' on ' + chain + ', then borrow $20 of USDC against it and keep both legs open.'; } },
    { words: ['dex', 'leveraged farm'], move: function (cap, name, chain) { return 'Provide $' + cap + ' of liquidity to ' + name + "'s main pool on " + chain + ' in the $USDC pair and keep the position open.'; } },
    { words: ['bridge', 'canonical'], move: function (cap, name, chain) { return 'Bridge $' + cap + ' of USDC to ' + chain + ' through ' + name + ', then use the bridged funds in an app on ' + chain + '.'; } },
    { words: ['liquid staking', 'restak', 'staking pool'], move: function (cap, name, chain) { return 'Stake $' + cap + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.'; } },
    { words: ['perpetual', 'derivative', 'basis', 'option'], move: function (cap, name, chain) { return 'Deposit $' + cap + ' of USDC as margin on ' + name + ' on ' + chain + ' and open one small hedged trade.'; } },
    { words: ['prediction'], move: function (cap, name, chain) { return 'Fund $' + cap + ' and place one small market position on ' + name + ' on ' + chain + '.'; } },
    { words: ['curator', 'allocator', 'risk'], move: function (cap, name, chain) { return 'Deposit $' + cap + ' into a ' + name + ' vault on ' + chain + ' and keep the vault shares.'; } },
    { words: ['stable'], move: function (cap, name, chain) { return 'Mint or deposit $' + cap + ' of the stable asset through ' + name + ' on ' + chain + ' and hold it.'; } },
    { words: ['rwa'], move: function (cap, name, chain) { return 'Mint $' + cap + " of the protocol's yield-bearing asset on " + chain + ' and hold it.'; } },
    { words: ['insurance'], move: function (cap, name, chain) { return 'Buy $' + cap + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.'; } },
    { words: ['yield'], move: function (cap, name, chain) { return 'Deposit $' + cap + ' into ' + name + "'s main yield strategy on " + chain + ' and keep the receipt.'; } },
    { words: [], move: function (cap, name, chain) { return 'Deposit $' + cap + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.'; } },
  ];

  function openingMove(p, cap, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < OPENING_MOVES.length; i++) {
      var entry = OPENING_MOVES[i];
      if (entry.words.length === 0 || entry.words.some(function (w) { return category.indexOf(w) >= 0; })) {
        return entry.move(cap, p.name, chain);
      }
    }
    return '';
  }

  // Weekly habit playbook, same shape. Only categories with a habit of
  // their own get an entry — stable, RWA and insurance have an opening move
  // but fall through to the generic habit here.
  var WEEKLY_HABITS = [
    { words: ['lend', 'cdp', 'collateral'], habit: function (name) { return 'Each week, top up or repay $5 of the borrow on ' + name + ' so the position shows fresh activity.'; } },
    { words: ['dex', 'leveraged farm'], habit: function (name, chain) { return 'Each week, swap $5 through ' + name + ' on ' + chain + ' and add or remove a little liquidity.'; } },
    { words: ['bridge', 'canonical'], habit: function (name, chain) { return 'Each week, bridge $5 through ' + name + ' to ' + chain + ' instead of moving everything at once.'; } },
    { words: ['liquid staking', 'restak', 'staking pool'], habit: function (name, chain) { return 'Each week, stake another $5 through ' + name + ' on ' + chain + ' and keep every receipt.'; } },
    { words: ['perpetual', 'derivative', 'basis', 'option'], habit: function (name, chain) { return 'Each week, open and close one $5 trade on ' + name + ' on ' + chain + ' and leave the margin in place.'; } },
    { words: ['prediction'], habit: function (name) { return 'Each week, place one $5 position on a new market on ' + name + '.'; } },
    { words: ['curator', 'allocator', 'risk'], habit: function (name, chain) { return 'Each week, add $5 to the ' + name + ' vault on ' + chain + ' or vote on its allocation if a vote is open.'; } },
    { words: ['yield'], habit: function (name, chain) { return 'Each week, claim or compound $5 of yield in ' + name + ' on ' + chain + '.'; } },
    { words: [], habit: function (name) { return 'Each week, make one small qualifying action on ' + name + ' — a deposit, a swap or a vote.'; } },
  ];

  function weeklyHabit(p, chain) {
    var category = (p.category || '').toLowerCase();
    for (var i = 0; i < WEEKLY_HABITS.length; i++) {
      var entry = WEEKLY_HABITS[i];
      if (entry.words.length === 0 || entry.words.some(function (w) { return category.indexOf(w) >= 0; })) {
        return entry.habit(p.name, chain);
      }
    }
    return '';
  }

  // One step as a display string: action, then cost and time.
  function renderStep(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }

  // The seven-step farm plan for one row, as display strings.
  function farmPlan(p) {
    var chain = primaryChain(p);
    var second = secondaryChain(p);
    var cap = stakeSize(p);
    var hold = holdWindow(p.age_days);
    var small = Math.max(20, Math.round(cap / 5));
    var chainStep = second === null
      ? { text: p.name + ' runs on ' + chain + ' only, so keep the whole position there and do not split it across chains that the protocol does not support.', cost: 'no extra gas beyond the main position', time: '5 minutes to check the chain list' }
      : { text: 'Repeat a smaller $' + small + ' position on ' + second + ' through ' + p.name + ' so the wallet is active on two of its chains.', cost: '$' + small + ' of capital and about $3 of gas', time: '15 minutes to set up' };
    var plan = [];
    plan.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
    plan.push({ text: openingMove(p, cap, chain), cost: '$' + cap + ' of capital and about $' + (cap >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
    plan.push(chainStep);
    plan.push({ text: weeklyHabit(p, chain), cost: 'about $2 of gas a week', time: '10 minutes a week' });
    plan.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + cap + ' stays in the position', time: hold + ' days' });
    plan.push({ text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
    plan.push({ text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in two halves instead of all at once.', cost: 'nothing but the log, plus about $4 of exit gas', time: '10 minutes to unwind' });
    return plan.map(renderStep);
  }

  // The view's state, in the location hash, so a filtered board and an open
  // detail drawer survive a reload and can be linked to.
  function readLocation() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.query = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('tab')) view.tab = params.get('tab');
  }

  function saveLocation() {
    var params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.tab !== 'pre-token') params.set('tab', view.tab);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Rows that pass the current filters and search, in board order.
  function visibleRows() {
    var q = view.query.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  // The value one row sorts by, for the active sort key.
  function sortValue(r) {
    if (view.sort === 'name') return r.name.toLowerCase();
    if (view.sort === 'tvl') return r.tvl_usd;
    if (view.sort === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (view.sort === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (view.sort === 'rank') return r.rank;
    return r.implied_value_usd;
  }

  function orderedRows(list) {
    return list.slice().sort(function (a, b) {
      var av = sortValue(a);
      var bv = sortValue(b);
      if (av < bv) return -view.dir;
      if (av > bv) return view.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // The masthead: brand on the left, snapshot facts on the right.
  function masthead() {
    return h('header', { cls: 'top' },
      h('div', { cls: 'brand' }, h('span', { cls: 'mark' }), h('span', { cls: 'brand-name', txt: 'Token Radar' })),
      h('div', { cls: 'top-meta' },
        h('span', null, 'Snapshot ', h('b', { txt: DATA.as_of })),
        h('span', { txt: 'DefiLlama protocol index' }),
        h('span', null, h('b', { txt: DATA.model_version }), ' model')
      )
    );
  }

  // The lede: what the board is, plus the four headline figures.
  function intro() {
    return h('section', { cls: 'lede' },
      h('div', null,
        h('h1', { txt: DATA.board_size + ' pre-token protocols, ranked by implied value' }),
        h('p', null, 'The watchlist is the floor: every protocol with at least ', h('b', { txt: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }), ' of TVL and no token on record. The radar below it carries ', h('b', { txt: String(DATA.early_size) }), ' more pre-token protocols — the full rankable universe, not a capped top-N. Implied value is a model, not a promise.')
      ),
      h('div', { cls: 'facts' },
        h('div', { cls: 'fact' }, h('span', { txt: 'Watchlist covered' }), h('b', { txt: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { cls: 'fact' }, h('span', { txt: 'Pre-token rows scored' }), h('b', { txt: String(DATA.board_size) })),
        h('div', { cls: 'fact' }, h('span', { txt: 'Early rows below the floor' }), h('b', { txt: String(DATA.early_size) })),
        h('div', { cls: 'fact' }, h('span', { txt: 'Live-token protocols set aside' }), h('b', { txt: String(DATA.live_size) }))
      )
    );
  }

  // The top three rows as cards that open their detail drawer.
  function podium() {
    var cards = DATA.rows.slice(0, 3).map(function (r) {
      return h('button', { cls: 'top3-card', type: 'button', onclick: function () { showDetail(r.slug); } },
        h('span', { cls: 'rank-tag', txt: 'RANK ' + r.rank }),
        h('b', { txt: r.name }),
        h('span', { cls: 'num', txt: money(r.implied_value_usd) }),
        h('span', { cls: 'sub', txt: (r.category || 'Other') + ' · TVL ' + money(r.tvl_usd) + ' · ' + pct(r.change_7d) + ' in 7d' })
      );
    });
    return h('section', { cls: 'top3' }, cards);
  }

  // Search, category and chain filters, the token-status tabs, and the count.
  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.query, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.query = search.value; saveLocation(); paint(); });
    var categorySelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', txt: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, txt: c, selected: c === view.category ? 'selected' : null }); })
    );
    categorySelect.addEventListener('change', function () { view.category = categorySelect.value; saveLocation(); paint(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', txt: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, txt: c, selected: c === view.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { view.chain = chainSelect.value; saveLocation(); paint(); });
    var preTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', txt: 'Pre-token', onclick: function () { view.tab = 'pre-token'; paint(); } });
    var liveTab = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', txt: 'Live token', onclick: function () { view.tab = 'live'; paint(); } });
    return h('div', { cls: 'controls' },
      h('div', { cls: 'field' }, h('label', { for: 'q', txt: 'Search' }), search),
      h('div', { cls: 'field' }, h('label', { for: 'category', txt: 'Category' }), categorySelect),
      h('div', { cls: 'field' }, h('label', { for: 'chain', txt: 'Chain' }), chainSelect),
      h('div', { cls: 'field' }, h('span', { cls: 'sub', txt: 'Token status' }), h('div', { cls: 'tabs' }, preTab, liveTab)),
      h('span', { cls: 'count', txt: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  // One sortable column header: clicking it sorts, clicking again reverses.
  function sortCell(key, label) {
    return h('th', { scope: 'col' },
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } paint(); } },
        label,
        view.sort === key ? h('span', { 'aria-hidden': 'true', txt: view.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  // A row's protocol cell: name, category and chains, plus a watchlist badge.
  function nameBlock(r) {
    var sub = h('span', { cls: 'sub', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') });
    var cell = h('div', { cls: 'name' }, h('b', { txt: r.name }), sub);
    if (ON_WATCH[r.slug]) cell.appendChild(h('span', { cls: 'watch', txt: 'watchlist' }));
    return cell;
  }

  // The pre-token board: one row per protocol, strongest implied value first.
  function preTokenTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { cls: 'panel' }, h('div', { cls: 'empty' },
        h('h2', { txt: 'No protocol matches that filter' }),
        h('p', { txt: 'Clear the search or pick another category to see the board again.' }),
        h('button', { cls: 'button primary', type: 'button', txt: 'Clear filters', onclick: function () { view.query = ''; view.category = 'all'; view.chain = 'all'; saveLocation(); paint(); } })
      ));
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = h('tr', {
        'data-selected': view.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { showDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showDetail(r.slug); } }
      },
        h('td', { cls: 'num', txt: String(r.rank) }),
        h('td', null, nameBlock(r)),
        h('td', { cls: 'num', txt: money(r.tvl_usd) }),
        h('td', { cls: 'num ' + growthClass, txt: growth }),
        h('td', { cls: 'num', txt: ageLabel(r.age_days) }),
        h('td', null, h('div', { cls: 'implied' },
          h('div', { cls: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { cls: 'num', txt: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { cls: 'status', txt: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { cls: 'panel' },
      h('div', { cls: 'table-wrap' },
        h('table', null,
          h('caption', { cls: 'sub', txt: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan.' }),
          h('thead', null, h('tr', null,
            sortCell('rank', 'Rank'),
            sortCell('name', 'Protocol'),
            sortCell('tvl', 'TVL'),
            sortCell('growth', '7d'),
            sortCell('age', 'Age'),
            sortCell('implied', 'Implied value'),
            h('th', { scope: 'col', txt: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // The live-token view: protocols that already trade, with market caps.
  function liveTokenTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { cls: 'num', txt: 'live' }),
        h('td', null, h('div', { cls: 'name' }, h('b', { txt: r.name }), h('span', { cls: 'sub', txt: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { cls: 'num', txt: money(r.tvl_usd) }),
        h('td', { cls: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), txt: pct(r.change_7d) }),
        h('td', { cls: 'num', txt: money(r.mcap_usd) }),
        h('td', null, h('span', { cls: 'status', txt: 'already trades' }))
      ));
    });
    return h('div', { cls: 'panel' },
      h('div', { cls: 'table-wrap' },
        h('table', null,
          h('caption', { cls: 'sub', txt: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', txt: 'Status' }), h('th', { scope: 'col', txt: 'Protocol' }), h('th', { scope: 'col', txt: 'TVL' }), h('th', { scope: 'col', txt: '7d' }), h('th', { scope: 'col', txt: 'Market cap' }), h('th', { scope: 'col', txt: 'Token' }))),
          tbody
        )
      )
    );
  }

  // The model, stated in full: the formula, what each factor means, and
  // what the board covers. The numbers come from the data, not the text.
  function modelExplainer() {
    var m = DATA.model;
    var formula = 'implied = round( ' + m.power_scale + ' x tvl_usd^' + m.power_exponent +
      ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight +
      ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range +
      ') x (1 + min(chains - 1, ' + m.breadth_cap_chains + ') x ' + m.breadth_step + ') )';
    return h('section', { cls: 'panel model' },
      h('h2', { txt: 'How implied value is computed — model ' + DATA.model_version }),
      h('p', { cls: 'sub', txt: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      h('div', { cls: 'formula' }, formula),
      h('dl', null,
        h('div', null, h('dt', { txt: 'Size — power law on TVL' }), h('dd', { txt: 'TVL is the anchor, but it scales sublinearly: implied value grows with the square root of TVL, so the biggest protocols are worth proportionally less per dollar locked.' })),
        h('div', null, h('dt', { txt: 'Momentum — growth x 0.75' }), h('dd', { txt: 'Seven-day TVL change, clamped to -50%..+150%. Fast-growing protocols are worth more than shrinking ones of the same size.' })),
        h('div', null, h('dt', { txt: 'Maturity — age up to 4 years' }), h('dd', { txt: 'Days since first listed with no token. Older no-token protocols have survived longer; unknown age counts as ' + m.unknown_age_days + ' days.' })),
        h('div', null, h('dt', { txt: 'Breadth — +3% per extra chain' }), h('dd', { txt: 'Each chain beyond the first, up to four, adds 3%: a wider distribution surface for a launch, never the driver.' }))
      ),
      h('p', { cls: 'sub', txt: 'The board is the full rankable universe: all ' + DATA.watchlist_size + ' watchlist protocols plus every pre-token protocol below the $' + Math.round(DATA.floor_usd / 1e6) + 'M floor. Live-token protocols are set aside with their market caps shown, never ranked as if they had no token.' })
    );
  }

  var dialog = h('dialog', { cls: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; saveLocation(); });

  // The detail drawer for one protocol: its model inputs, the recomputed
  // implied value next to the board's, and its seven-step farm plan.
  function showDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    saveLocation();
    dialog.textContent = '';
    var steps = farmPlan(row);
    var fresh = recompute(row, DATA.model);
    dialog.appendChild(h('div', { cls: 'detail-head' },
      h('div', null,
        h('span', { cls: 'brand-name', txt: 'Rank ' + row.rank + ' of ' + DATA.board_size + (ON_WATCH[row.slug] ? ' · watchlist' : '') }),
        h('h2', { id: 'detail-title', txt: row.name }),
        h('p', { cls: 'sub', txt: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      h('button', { cls: 'close', type: 'button', 'aria-label': 'Close details', txt: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { txt: 'Implied value' }),
      h('div', { cls: 'equation' },
        h('div', null, h('span', { txt: 'TVL' }), h('b', { cls: 'num', txt: money(row.tvl_usd) })),
        h('div', null, h('span', { txt: 'Base (' + DATA.model.power_scale + ' x TVL^' + DATA.model.power_exponent + ')' }), h('b', { cls: 'num', txt: money(DATA.model.power_scale * Math.pow(row.tvl_usd, DATA.model.power_exponent)) })),
        h('div', null, h('span', { txt: 'Seven-day growth' }), h('b', { cls: 'num', txt: pct(row.change_7d) })),
        h('div', null, h('span', { txt: 'Age with no token' }), h('b', { cls: 'num', txt: ageLabel(row.age_days) + (row.age_days === null ? ' (assumed ' + DATA.model.unknown_age_days + 'd)' : '') })),
        h('div', null, h('span', { txt: 'Growth multiplier' }), h('b', { cls: 'num', txt: String(row.growth_multiplier) })),
        h('div', null, h('span', { txt: 'Maturity multiplier' }), h('b', { cls: 'num', txt: String(row.maturity_multiplier) })),
        h('div', null, h('span', { txt: 'Breadth multiplier (' + (row.chains || []).length + ' chains)' }), h('b', { cls: 'num', txt: String(row.breadth_multiplier) })),
        h('div', { cls: 'total' }, h('span', { txt: 'Implied value' }), h('b', { cls: 'num', txt: money(row.implied_value_usd) }))
      ),
      h('p', { cls: 'sub', txt: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + money(fresh) + (fresh === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { txt: 'Farm plan — 7 steps' }),
      h('ol', { cls: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { txt: action }), h('span', { cls: 'cost', txt: tail }));
      })),
      h('p', { cls: 'note', txt: 'Capital scales with the protocol TVL; the hold scales with its age. Never pay to claim, and never share a seed phrase.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // Paint the whole page from the current view, then reopen the drawer
  // when the hash names a protocol.
  function paint() {
    mount.textContent = '';
    var shell = h('div', { cls: 'shell' });
    shell.appendChild(masthead());
    shell.appendChild(intro());
    if (view.tab === 'pre-token') shell.appendChild(podium());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? preTokenTable() : liveTokenTable());
    if (view.tab === 'pre-token') shell.appendChild(modelExplainer());
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) showDetail(view.selected);
  }

  readLocation();
  paint();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
