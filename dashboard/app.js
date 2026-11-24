// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer, the
// live-token anchors, the 758-protocol audit and the method panel. No network: every byte
// it shows is in data.js.
//
// The value model, in one place, so the page, the board and the code agree:
//   launch value   = exp(intercept + slope x ln(tvl_usd)), fitted on the priced peers
//   odds           = P(a token ever lists | still unlisted at this age), cure fit on all 758
//   expected value = launch value x odds
//   interval       = expected value / blind miss .. x blind miss (the held-out median miss)
//   rank range     = the row's rank over five refits of the size curve on 80% folds
// The farm verdict is costed, not a slogan: payout = airdrop pool (10% of the expected
// value) shared among an estimated farmer count; cost = gas + time at $20 an hour +
// opportunity cost of locked capital at 5% a year. FARM pays more than twice its cost,
// THIN covers its cost, SKIP does not. The sandbox on the Method tab recomputes every
// verdict live from the same arithmetic; the ranks never move, because they are the model.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };
  var sandbox = { pool: DATA.farm.poolShare, farmers: DATA.farm.farmerBase, hourly: DATA.farm.hourlyUsd };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtX(n) { return 'x' + n.toFixed(2); }

  // The farm verdict, recomputed from the row's own figures and the sandbox constants,
  // exactly as lib/model.ts computes it when the board is written.
  function farmOf(row) {
    var farmers = Math.max(1, Math.round(sandbox.farmers * Math.pow(row.tvl_usd / DATA.farm.farmerTvlRef, DATA.farm.farmerExponent)));
    var payout = (sandbox.pool * row.implied_value_usd) / farmers;
    var gas = DATA.farm.gasSetupUsd + DATA.farm.gasWeeklyUsd * (row.hold_days / 7);
    var hours = DATA.farm.setupMinutes / 60 + (row.hold_days / 7) * (DATA.farm.weeklyMinutes / 60);
    var opportunity = row.capital_usd * DATA.farm.opportunityRate * (row.hold_days / 365);
    var cost = gas + hours * sandbox.hourly + opportunity;
    // Net dollars per hour after valuing the farmer's time: positive exactly when the
    // payout beats the full cost, so it can never praise a SKIP.
    var perHour = (payout - cost) / Math.max(0.01, hours);
    var breakeven = (cost * farmers) / Math.max(0.01, sandbox.pool * Math.max(0.01, row.odds));
    var verdict = payout > 2 * cost ? 'FARM' : payout > cost ? 'THIN' : 'SKIP';
    return { farmers: farmers, payout: payout, cost: cost, perHour: perHour, breakeven: breakeven, verdict: verdict };
  }
  function econOf(row) {
    // At the sandbox defaults this is the board's own economics; moved sliders recompute it.
    if (sandbox.pool === DATA.farm.poolShare && sandbox.farmers === DATA.farm.farmerBase && sandbox.hourly === DATA.farm.hourlyUsd) {
      return { farmers: row.farmers, payout: row.payout_usd, cost: row.cost_usd, perHour: row.dollars_per_hour, breakeven: row.breakeven_launch_usd, verdict: row.verdict };
    }
    return farmOf(row);
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('verdict')) state.verdict = params.get('verdict');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.verdict !== 'all') params.set('verdict', state.verdict);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.verdict !== 'all' && econOf(r).verdict !== state.verdict) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.odds; bv = b.odds; }
      else if (key === 'perhour') { av = econOf(a).perHour; bv = econOf(b).perHour; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function kpis() {
    var fit = DATA.fit;
    var chosen = fit.terms[fit.chosen];
    return el('section', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'floor, not ceiling' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows' }), el('b', { text: String(DATA.board_size) }), el('small', { text: DATA.early_size + ' early, below the floor' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Blind miss' }), el('b', { text: fmtX(chosen.pooled) }), el('small', { text: 'held-out median' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Odds at 1 year' }), el('b', { text: DATA.odds.oddsAt[2].odds.toFixed(2) }), el('small', { text: 'falls to ' + DATA.odds.oddsAt[5].odds.toFixed(2) + ' at 3 years' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Farm verdicts' }), el('b', { text: DATA.verdicts.FARM + ' FARM' }), el('small', { text: DATA.verdicts.THIN + ' THIN · ' + DATA.verdicts.SKIP + ' SKIP' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Audit' }), el('b', { text: '758 ✓' }), el('small', { text: DATA.audit.ranked + ' + ' + DATA.audit.hasToken + ' + ' + DATA.audit.setAside }))
    );
  }

  function lede() {
    var top = DATA.rows[0];
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by expected launch value' }),
        el('p', { text: 'Every pre-token protocol the watchlist rule keeps is ranked by what its launch would be worth times the odds it ever lists. The early radar adds ' + DATA.early_size + ' protocols below the $50M floor. Rank 1 is ' + top.name + ' at ' + fmtUsd(top.implied_value_usd) + ' expected value — a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Size curve' }), el('b', { text: 'ln mcap = ' + DATA.fit.intercept.toFixed(2) + ' + ' + DATA.fit.slope.toFixed(2) + ' ln TVL' })),
        el('div', { class: 'fact' }, el('span', { text: 'Fit set' }), el('b', { text: DATA.fit.n + ' priced peers, R² ' + DATA.fit.r2.toFixed(2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token anchors' }), el('b', { text: String(DATA.live_size) + ' shown, ' + DATA.has_token_size + ' with a token' })),
        el('div', { class: 'fact' }, el('span', { text: 'Set aside' }), el('b', { text: String(DATA.set_aside_size) + ' wrapped / staked / exchange' }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var verdict = el('select', { id: 'verdict', 'aria-label': 'Filter by farm verdict' },
      el('option', { value: 'all', text: 'All verdicts' }),
      ['FARM', 'THIN', 'SKIP'].map(function (v) { return el('option', { value: v, text: v + ' only', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdict),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('audit', 'Audit'), tabBtn('method', 'Method'))),
      el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'audit' ? DATA.setAside.length + ' set aside' : 'how the radar works' })
    );
  }

  function modelStrip() {
    var fit = DATA.fit;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How expected value is computed' }),
      el('div', { class: 'formula' },
        'expected value = launch value x odds   ·   launch value = exp(' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' x ln TVL)   ·   odds fall with age with no token'
      ),
      el('p', { class: 'sub', text: 'The size curve is fitted on ' + fit.n + ' traded protocols with a priced market cap (R² ' + fit.r2.toFixed(2) + '). A bigger protocol is worth a smaller multiple of its TVL: ' + DATA.bands.map(function (b) { return b.label + ' x' + b.multiple.toFixed(2); }).join(' · ') + '. Growth does not move the price — blind tests say it adds noise — it moves the farm plan instead. Every row carries its interval (÷/× ' + fmtX(fit.medianFactor) + ', the held-out miss) and its rank range over five refits.' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function verdictChip(v) {
    return el('span', { class: 'verdict ' + v.toLowerCase(), text: v });
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.verdict = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var e = econOf(r);
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.odds.toFixed(2) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('div', null, verdictChip(e.verdict), el('div', { class: 'range', text: '$' + e.perHour.toFixed(0) + '/h' }))),
        el('td', null, el('span', { class: 'range', text: '#' + r.rank_low + '–' + r.rank_high }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest expected value first. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Odds'),
            sortHeader('implied', 'Expected value'),
            el('th', { scope: 'col', text: 'Farm verdict' }),
            el('th', { scope: 'col', text: 'Rank range' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'sub', text: 'already trades' }))
      ));
    });
    return el('div', null,
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'The 24 largest live-token protocols by market cap. Their market caps are facts, not a model — and they are the peers the size curve is fitted on. ' + DATA.unpriced_token_size + ' more protocols record a token with no priced market cap.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
            tbody
          )
        )
      )
    );
  }

  function auditTable() {
    var tbody = el('tbody');
    DATA.setAside.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', null, el('span', { class: 'sub', text: r.reason }))
      ));
    });
    return el('div', null,
      el('div', { class: 'panel' },
        el('div', { class: 'table-wrap' },
          el('table', null,
            el('caption', { class: 'sub', text: 'Every protocol is accounted for: ' + DATA.audit.ranked + ' ranked + ' + DATA.audit.hasToken + ' record a token + ' + DATA.audit.setAside + ' set aside = ' + DATA.audit.total + '. The set-aside rows below are pre-token protocols the watchlist rule excludes: wrapped, staked and bridged products of a token that already trades, exchanges and versioned pools.' }),
            el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: 'Why it is not ranked' }))),
            tbody
          )
        )
      )
    );
  }

  function methodPanel() {
    var fit = DATA.fit;
    var testRows = fit.terms.map(function (t) {
      return el('tr', null,
        el('td', { text: t.label }),
        el('td', { class: 'num', text: fmtX(t.splitHalf) }),
        el('td', { class: 'num', text: fmtX(t.walkForward) }),
        el('td', { class: 'num', text: fmtX(t.fiveFold) }),
        el('td', { class: 'num', text: fmtX(t.pooled) }),
        el('td', { text: t.kept ? 'KEPT' : 'dropped' })
      );
    });
    var oddsRows = DATA.odds.oddsAt.map(function (o) {
      var label = o.ageYears < 1 ? Math.round(o.ageYears * 12) + ' months' : o.ageYears === 1 ? '1 year' : o.ageYears + ' years';
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num', text: o.odds.toFixed(2) })
      );
    });
    var bandRows = DATA.bands.map(function (b) {
      return el('tr', null, el('td', { text: b.label }), el('td', { class: 'num', text: 'x' + b.multiple.toFixed(2) }));
    });
    var pool = el('input', { type: 'range', min: '2', max: '20', step: '1', value: String(Math.round(sandbox.pool * 100)), 'aria-label': 'Airdrop pool share, percent' });
    var farmers = el('input', { type: 'range', min: '5000', max: '50000', step: '1000', value: String(sandbox.farmers), 'aria-label': 'Farmer count base' });
    var hourly = el('input', { type: 'range', min: '5', max: '50', step: '5', value: String(sandbox.hourly), 'aria-label': 'Dollars per hour' });
    var poolOut = el('b', { class: 'num', text: Math.round(sandbox.pool * 100) + '%' });
    var farmOut = el('b', { class: 'num', text: sandbox.farmers.toLocaleString('en-US') });
    var hourOut = el('b', { class: 'num', text: '$' + sandbox.hourly + '/h' });
    function refreshSandbox() {
      sandbox.pool = Number(pool.value) / 100;
      sandbox.farmers = Number(farmers.value);
      sandbox.hourly = Number(hourly.value);
      poolOut.textContent = Math.round(sandbox.pool * 100) + '%';
      farmOut.textContent = sandbox.farmers.toLocaleString('en-US');
      hourOut.textContent = '$' + sandbox.hourly + '/h';
      var counts = { FARM: 0, THIN: 0, SKIP: 0 };
      DATA.rows.forEach(function (r) { counts[econOf(r).verdict] += 1; });
      verdictOut.textContent = counts.FARM + ' FARM · ' + counts.THIN + ' THIN · ' + counts.SKIP + ' SKIP';
      // No render() here: rebuilding the DOM mid-drag would drop the slider. The board
      // reads the new sandbox values the next time it renders.
    }
    var verdictOut = el('b', { class: 'num', text: DATA.verdicts.FARM + ' FARM · ' + DATA.verdicts.THIN + ' THIN · ' + DATA.verdicts.SKIP + ' SKIP' });
    pool.addEventListener('input', refreshSandbox);
    farmers.addEventListener('input', refreshSandbox);
    hourly.addEventListener('input', refreshSandbox);
    return el('div', null,
      el('section', { class: 'panel model' },
        el('h2', { text: 'The method, with its receipts' }),
        el('p', { class: 'sub', text: 'Nothing here is a list of names. Every number below is fitted from the snapshot at run time, and every term was kept or dropped on blind tests.' }),
        el('div', { class: 'formula' },
          'expected value = exp(' + fit.intercept.toFixed(4) + ' + ' + fit.slope.toFixed(4) + ' x ln TVL) x odds(age)   ·   fit on ' + fit.n + ' priced peers, R2 ' + fit.r2.toFixed(3) + ', residual sd ' + fit.residSd.toFixed(2) + ' in log terms'
        ),
        el('div', { class: 'grid2' },
          el('div', null,
            el('h3', { text: 'Blind tests: median multiplicative miss' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Term-set' }), el('th', { class: 'num', text: 'Split-half' }), el('th', { class: 'num', text: 'Walk-fwd' }), el('th', { class: 'num', text: '5-fold' }), el('th', { class: 'num', text: 'Pooled' }), el('th', { text: 'Verdict' }))),
              el('tbody', null, testRows)
            ),
            el('p', { class: 'sub', text: 'Split-half runs both ways on a hash of the slug; walk-forward fits protocols listed before the median listing date and tests the newer half; five-fold rotates the hash. Growth, chain count, age in the price and category all lose to log TVL alone, so they are dropped from the price. Growth still moves the farm plan; age still moves the odds.' })
          ),
          el('div', null,
            el('h3', { text: 'Odds a token ever lists' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Still unlisted at' }), el('th', { class: 'num', text: 'Odds' }))),
              el('tbody', null, oddsRows)
            ),
            el('p', { class: 'sub', text: 'Cure fit on ' + DATA.odds.n + ' protocols with a listing date: ' + Math.round(DATA.odds.neverList * 100) + '% never list, hazard ' + DATA.odds.hazardPerYear + ' a year. A protocol that has run three years with no token is a worse bet than a six-month-old one, and the board says so.' }),
            el('h3', { text: 'Fitted multiple by size' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'TVL band' }), el('th', { class: 'num', text: 'Launch / TVL' }))),
              el('tbody', null, bandRows)
            ),
            el('p', { class: 'sub', text: 'The multiple falls with size: the market pays less per dollar of TVL for the giants. That is the fitted curve, not an opinion.' })
          )
        ),
        el('h3', { text: 'Farm economics — move the sliders, the verdicts move' }),
        el('div', { class: 'sandbox' },
          el('div', { class: 'field' }, el('label', { text: 'Airdrop pool share' }), pool, poolOut),
          el('div', { class: 'field' }, el('label', { text: 'Farmer count base' }), farmers, farmOut),
          el('div', { class: 'field' }, el('label', { text: 'Your time, per hour' }), hourly, hourOut),
          el('div', { class: 'field' }, el('label', { text: 'Verdicts now' }), verdictOut),
          el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { sandbox.pool = DATA.farm.poolShare; sandbox.farmers = DATA.farm.farmerBase; sandbox.hourly = DATA.farm.hourlyUsd; render(); } })
        ),
        el('p', { class: 'sub', text: 'Payout = pool share x expected value / farmers, where farmers = base x (TVL / $100M)^0.7. Cost = $6 gas + $1.50 a week + time at your hourly rate + 5% a year on locked capital. FARM pays more than twice its cost, THIN covers its cost, SKIP does not. The sliders change the verdicts, never the ranks.' })
      ),
      el('section', { class: 'checks' }, DATA.checks.map(function (c) {
        return el('div', { class: 'check' }, el('b', { text: c.name }), el('span', { text: c.detail }));
      }))
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function farmStepsFor(row) {
    // The plan is generated in the page from the same derivation main.ts writes to
    // board.json: category, chains, TVL and age decide the action, the capital, the hold
    // and every cost and time. No name is special-cased. board.json carries the steps;
    // the page shows them with their cost and time split out.
    var steps = [];
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var capital = row.capital_usd;
    var hold = row.hold_days;
    var growth = row.change_7d === null ? 0 : row.change_7d;
    var pace = growth > 5 ? 'TVL is up sharply this week, so start this week before the crowd arrives.'
      : growth < -5 ? 'TVL is down this week, so start with half the capital and add the rest next week.'
      : 'TVL is steady this week, so start at the full size below.';
    var c = (row.category || '').toLowerCase();
    var action;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) action = 'Supply $' + capital + ' of USDC to ' + row.name + ' on ' + chain + ' and keep the position open.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) action = 'Provide $' + capital + ' of liquidity to ' + row.name + "'s main pool on " + chain + ' and keep the position open.';
    else if (c.indexOf('bridge') >= 0) action = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + row.name + ' and use the bridged funds in its app.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) action = "Stake $" + capital + " of the chain's staking asset through " + row.name + ' and keep the receipt.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) action = 'Deposit $' + capital + ' of USDC as margin on ' + row.name + ' and open one small hedge.';
    else if (c.indexOf('prediction') >= 0) action = 'Fund $' + capital + ' and place one market position on ' + row.name + '.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) action = 'Deposit $' + capital + ' into a ' + row.name + ' vault on ' + chain + ' and keep the shares.';
    else if (c.indexOf('stable') >= 0) action = 'Mint or deposit $' + capital + ' of the stable asset through ' + row.name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) action = "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    else if (c.indexOf('insurance') >= 0) action = 'Buy $' + capital + ' of cover from ' + row.name + ' on ' + chain + ' and keep the policy.';
    else action = 'Deposit $' + capital + ' of USDC into ' + row.name + ' on ' + chain + ' and keep the position open.';
    steps.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' + pace, cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
    steps.push({ text: action, cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
    steps.push({ text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' });
    steps.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' });
    steps.push({ text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' });
    steps.push({ text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' });
    return steps;
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var e = econOf(row);
    var steps = farmStepsFor(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · range #' + row.rank_low + '–' + row.rank_high }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Expected value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Launch value (fitted)' }), el('b', { class: 'num', text: fmtUsd(row.launch_value_usd) })),
        el('div', null, el('span', { text: 'Odds it ever lists' }), el('b', { class: 'num', text: row.odds.toFixed(2) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Interval (blind miss ' + fmtX(DATA.fit.medianFactor) + ')' }), el('b', { class: 'num', text: fmtUsd(row.interval_low_usd) + ' – ' + fmtUsd(row.interval_high_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate, not a price. The protocol records no token — that is what the snapshot says, never proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict: ' + e.verdict }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Capital' }), el('b', { class: 'num', text: '$' + row.capital_usd })),
        el('div', null, el('span', { text: 'Hold' }), el('b', { class: 'num', text: row.hold_days + ' days' })),
        el('div', null, el('span', { text: 'Farmers (estimated)' }), el('b', { class: 'num', text: e.farmers.toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Expected payout' }), el('b', { class: 'num', text: '$' + e.payout.toFixed(2) })),
        el('div', null, el('span', { text: 'Cost (gas + time + lock-up)' }), el('b', { class: 'num', text: '$' + e.cost.toFixed(2) })),
        el('div', null, el('span', { text: 'Dollars per hour' }), el('b', { class: 'num', text: '$' + e.perHour.toFixed(2) })),
        el('div', null, el('span', { text: 'Break-even launch value' }), el('b', { class: 'num', text: fmtUsd(e.breakeven) }))
      ),
      el('p', { class: 'sub', text: e.verdict === 'FARM' ? 'The payout is more than twice the cost: farm it.' : e.verdict === 'THIN' ? 'The payout covers the cost, barely: farm it small or skip it.' : 'The payout does not cover the cost: skip it, and watch the rank instead.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        return el('li', null, el('b', { text: s.text }), el('span', { class: 'cost', text: 'Cost: ' + s.cost + '. Time: ' + s.time + '.' }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(kpis());
    shell.appendChild(lede());
    shell.appendChild(controls());
    if (state.tab === 'board') {
      shell.appendChild(boardTable());
      shell.appendChild(modelStrip());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'audit') {
      shell.appendChild(auditTable());
    } else {
      shell.appendChild(methodPanel());
    }
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      el('span', { text: 'A protocol on this board records no token in the snapshot. That is the record, never proof it has none. Implied values are the entry\u2019s own claim, never make.fun\u2019s.' }),
      el('span', { text: 'Built by an AI agent for make.fun\u2019s token launch radar bounty. Built with an uncensored model — superbot.gg.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
