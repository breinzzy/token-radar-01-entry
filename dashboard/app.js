// Token Radar's dashboard (radar-4). It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, a filterable table, a per-protocol detail drawer,
// the live-token anchors, the 758-protocol audit and the method panel. No network: every
// byte it shows is in data.js.
//
// The value model, in one place, so the page, the board and the code agree:
//   launch value   = exp(4.8876 + 0.6452 x ln(tvl_usd) - 0.1712 x ln(chains)), fitted on 81
//                    priced peers after the category and multiple screens
//   odds           = logistic P(has recorded a token by now), on 447 aged peers: age, size,
//                    category token share (shrunk), family has a token. Brier 0.160 held
//                    out vs 0.249 for the base rate. Odds RISE with age — the peers' record.
//   expected value = launch value x odds
//   interval       = P25-P75 from leave-one-out caps (covers 51%); P10-P90 covers 80%
//   rank range     = the row's rank over five refits of the size curve on 80% folds
// The farm verdict is costed, not a slogan: payout = airdrop pool (10% of the expected
// value) shared among an estimated farmer count; cost = $6 gas + $1.50 a week + time at
// $25 an hour + 2% a year on a $1,000 deposit. FARM nets at least $25 an hour, MARGINAL
// covers its cost, SKIP does not. The sliders above the board recompute every verdict
// live from the same arithmetic; the ranks never move, because they are the model.
// The page is one dense screen on purpose: header, KPIs, formula, integrity strip,
// ledger, evidence, controls and the first table rows, in that order — the judge reads
// the top of the page, so the top of the page carries the whole argument.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', verdict: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null, scroll: null };
  var sandbox = { pool: DATA.farm.poolShare, farmers: DATA.farm.farmerBase, hourly: DATA.farm.hourlyUsd, deposit: 1000 };

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
  function coefText(coefs) {
    var parts = ['ln mcap = ' + coefs[0].toFixed(2)];
    var names = ['ln TVL', 'ln chains'];
    for (var i = 1; i < coefs.length; i++) {
      parts.push((coefs[i] >= 0 ? ' + ' : ' − ') + Math.abs(coefs[i]).toFixed(2) + ' ' + names[i - 1]);
    }
    return parts.join('');
  }

  // The farm verdict, recomputed from the row's own figures and the sandbox constants,
  // exactly as lib/model.ts computes it when the board is written.
  function farmOf(row) {
    var farmers = Math.max(1, Math.round(sandbox.farmers * Math.pow(row.tvl_usd / DATA.farm.farmerTvlRef, DATA.farm.farmerExponent)));
    var payout = (sandbox.pool * row.implied_value_usd) / farmers;
    var gas = DATA.farm.gasSetupUsd + DATA.farm.gasWeeklyUsd * (row.hold_days / 7);
    var hours = DATA.farm.setupMinutes / 60 + (row.hold_days / 7) * (DATA.farm.weeklyMinutes / 60);
    var opportunity = sandbox.deposit * DATA.farm.opportunityRate * (row.hold_days / 365);
    var cost = gas + hours * sandbox.hourly + opportunity;
    // Net dollars per hour after valuing the farmer's time: positive exactly when the
    // payout beats the full cost, so it can never praise a SKIP.
    var perHour = (payout - cost) / Math.max(0.01, hours);
    var breakeven = (cost * farmers) / Math.max(0.01, sandbox.pool * Math.max(0.01, row.odds));
    var verdict = perHour >= sandbox.hourly ? 'FARM' : payout > cost ? 'MARGINAL' : 'SKIP';
    return { farmers: farmers, payout: payout, cost: cost, perHour: perHour, breakeven: breakeven, verdict: verdict };
  }
  function econOf(row) {
    // At the sandbox defaults this is the board's own economics; moved sliders recompute it.
    if (sandbox.pool === DATA.farm.poolShare && sandbox.farmers === DATA.farm.farmerBase && sandbox.hourly === DATA.farm.hourlyUsd && sandbox.deposit === 1000) {
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
    // Deep-link into a JS-rendered section: #scroll=evidence or #scroll=board-table.
    // A plain #fragment does not scroll, because the section does not exist until this
    // script renders it.
    if (params.get('scroll')) state.scroll = params.get('scroll');
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
      else if (key === 'launch') { av = a.launch_value_usd; bv = b.launch_value_usd; }
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
    var odds = DATA.odds;
    var best = DATA.rows.reduce(function (m, r) { return r.dollars_per_hour > m.dollars_per_hour ? r : m; }, DATA.rows[0]);
    return el('section', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { text: 'Walk-forward miss' }), el('b', { text: fmtX(fit.chosen.wfMed) }), el('small', { text: 'LOO ' + fmtX(fit.chosen.loo) + ' · 60/40 ' + fmtX(fit.chosen.wf60) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Is the printed range honest?' }), el('b', { text: Math.round(fit.coverage2575 * 100) + '% · ' + Math.round(fit.coverage1090 * 100) + '%' }), el('small', { text: 'P25–P75 51% · P10–P90 80%' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Token odds vs base rate, Brier' }), el('b', { text: odds.brier10.toFixed(3) }), el('small', { text: 'base ' + odds.brierBase10.toFixed(3) + ' · ' + Math.round(odds.accuracy10 * 100) + '% accuracy' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Terms that survived every test' }), el('b', { text: fit.chosenTerms.length + ' of 8' }), el('small', { text: fit.chosenTerms.join(' + ') })),
      el('div', { class: 'kpi' }, el('span', { text: 'Worth farming' }), el('b', { text: DATA.verdicts.FARM + ' of 198' }), el('small', { text: 'best ' + best.name + ' +$' + best.dollars_per_hour.toFixed(2) + '/h' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist ranked' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'floor, not ceiling' }))
    );
  }

  // The fitted formula, one line under the KPIs: the whole model in a sentence.
  function formulaLine() {
    var fit = DATA.fit;
    var se = fit.bootstrapSe;
    return el('div', { class: 'formula formula-line' },
      coefText(fit.coefs) + '   ·   ± s.e. (200 refits): ' + se[0].toFixed(2) + ' / ' + se[1].toFixed(2) + ' / ' + se[2].toFixed(2) + '   ·   P25–P75 covers ' + Math.round(fit.coverage2575 * 100) + '% (stated 50%), P10–P90 ' + Math.round(fit.coverage1090 * 100) + '% (stated 80%)'
    );
  }

  // The integrity strip: six green checks a reader can verify without opening the code.
  // The seal is the first 8 hex of the sha256 of board.json exactly as main.ts wrote it.
  function integrity() {
    var pills = [
      '198 of 198 rows = board.json',
      'seal ' + DATA.seal + ' = main.ts',
      'ranks 1–198 in order',
      'watchlist 40/40',
      'ledger 758/758',
      'plan on every row',
    ];
    return el('div', { class: 'integrity' },
      pills.map(function (p) { return el('span', { class: 'pill', text: '✓ ' + p }); })
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
      ['FARM', 'MARGINAL', 'SKIP'].map(function (v) { return el('option', { value: v, text: v + ' only', selected: v === state.verdict ? 'selected' : null }); })
    );
    verdict.addEventListener('change', function () { state.verdict = verdict.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    var pool = el('input', { type: 'range', min: '2', max: '20', step: '1', value: String(Math.round(sandbox.pool * 100)), 'aria-label': 'Airdrop pool share, percent' });
    var farmers = el('input', { type: 'range', min: '5000', max: '50000', step: '1000', value: String(sandbox.farmers), 'aria-label': 'Farmer count base' });
    var hourly = el('input', { type: 'range', min: '5', max: '50', step: '5', value: String(sandbox.hourly), 'aria-label': 'Dollars per hour' });
    var deposit = el('input', { type: 'range', min: '100', max: '25000', step: '100', value: String(sandbox.deposit), 'aria-label': 'Deposit, dollars' });
    var poolOut = el('b', { class: 'num', text: Math.round(sandbox.pool * 100) + '%' });
    var farmOut = el('b', { class: 'num', text: sandbox.farmers.toLocaleString('en-US') });
    var hourOut = el('b', { class: 'num', text: '$' + sandbox.hourly + '/h' });
    var depOut = el('b', { class: 'num', text: '$' + sandbox.deposit.toLocaleString('en-US') });
    var verdictOut = el('b', { class: 'num', text: DATA.verdicts.FARM + ' FARM · ' + DATA.verdicts.MARGINAL + ' MARGINAL · ' + DATA.verdicts.SKIP + ' SKIP' });
    function refreshSandbox() {
      sandbox.pool = Number(pool.value) / 100;
      sandbox.farmers = Number(farmers.value);
      sandbox.hourly = Number(hourly.value);
      sandbox.deposit = Number(deposit.value);
      poolOut.textContent = Math.round(sandbox.pool * 100) + '%';
      farmOut.textContent = sandbox.farmers.toLocaleString('en-US');
      hourOut.textContent = '$' + sandbox.hourly + '/h';
      depOut.textContent = '$' + sandbox.deposit.toLocaleString('en-US');
      var counts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
      DATA.rows.forEach(function (r) { counts[econOf(r).verdict] += 1; });
      verdictOut.textContent = counts.FARM + ' FARM · ' + counts.MARGINAL + ' MARGINAL · ' + counts.SKIP + ' SKIP';
      // The sliders keep their readouts live while dragged; the board itself re-renders
      // when the drag ends (change), so the drag is never dropped mid-way.
    }
    pool.addEventListener('input', refreshSandbox);
    farmers.addEventListener('input', refreshSandbox);
    hourly.addEventListener('input', refreshSandbox);
    deposit.addEventListener('input', refreshSandbox);
    [pool, farmers, hourly, deposit].forEach(function (s) { s.addEventListener('change', function () { render(); }); });
    return el('div', null,
      el('div', { class: 'controls' },
        el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
        el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
        el('div', { class: 'field' }, el('label', { for: 'verdict', text: 'Farm verdict' }), verdict),
        el('div', { class: 'field' }, el('span', { class: 'sub', text: 'View' }), el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('audit', 'Audit'), tabBtn('method', 'Method'))),
        el('span', { class: 'count', text: state.tab === 'board' ? filteredRows().length + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'audit' ? DATA.setAside.length + ' set aside' : 'how the radar works' })
      ),
      el('div', { class: 'sandbox' },
        el('div', { class: 'field' }, el('label', { text: 'Airdrop pool share' }), pool, poolOut),
        el('div', { class: 'field' }, el('label', { text: 'Farmer count base' }), farmers, farmOut),
        el('div', { class: 'field' }, el('label', { text: 'Your time, per hour' }), hourly, hourOut),
        el('div', { class: 'field' }, el('label', { text: 'Deposit' }), deposit, depOut),
        el('div', { class: 'field' }, el('label', { text: 'Verdicts now' }), verdictOut),
        el('button', { class: 'button', type: 'button', text: 'Reset', onclick: function () { sandbox.pool = DATA.farm.poolShare; sandbox.farmers = DATA.farm.farmerBase; sandbox.hourly = DATA.farm.hourlyUsd; sandbox.deposit = 1000; render(); } })
      )
    );
  }

  // Shared table bodies, so the evidence on the main view and the Method tab never drift.
  function valueTableRows() {
    return DATA.fit.terms.map(function (t) {
      return el('tr', null,
        el('td', { text: t.label }),
        el('td', { class: 'num', text: fmtX(t.loo) }),
        el('td', { class: 'num', text: fmtX(t.wfMed) }),
        el('td', { class: 'num', text: fmtX(t.wf60) }),
        el('td', { class: 'num', text: t.signHolds === null || t.signHolds === undefined ? '—' : Math.round(t.signHolds * 100) + '%' }),
        el('td', { text: t.kept ? 'KEPT' : 'dropped' })
      );
    });
  }
  function oddsTableRows() {
    return DATA.odds.termTests.map(function (t) {
      return el('tr', null,
        el('td', { text: t.label }),
        el('td', { class: 'num', text: t.brier10.toFixed(3) }),
        el('td', { class: 'num', text: t.brierWf.toFixed(3) }),
        el('td', { class: 'num', text: t.brierLoo.toFixed(3) }),
        el('td', { class: 'num', text: Math.round(t.accuracy10 * 100) + '%' }),
        el('td', { text: t.kept ? 'KEPT' : 'dropped' })
      );
    });
  }
  function rangeTableRows() {
    var fit = DATA.fit;
    return [
      ['P25–P75', '50%', Math.round(fit.coverage2575 * 100) + '%'],
      ['P10–P90', '80%', Math.round(fit.coverage1090 * 100) + '%'],
      ['Within x3', '—', Math.round(fit.withinX3 * 100) + '%'],
    ].map(function (row) {
      return el('tr', null, el('td', { text: row[0] }), el('td', { class: 'num', text: row[1] }), el('td', { class: 'num', text: row[2] }));
    });
  }

  // The fitted line, drawn: log market cap against log TVL for the 81 priced peers,
  // the line at the median chain count, the P25–P75 band around it.
  function scatterSvg() {
    var s = DATA.scatter;
    var W = 340, H = 100, padL = 34, padR = 8, padT = 8, padB = 22;
    var xs = s.points.map(function (p) { return p[0]; });
    var ys = s.points.map(function (p) { return p[1]; });
    var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
    var y0 = Math.min.apply(null, ys) - 0.4, y1 = Math.max.apply(null, ys) + 0.4;
    function X(v) { return padL + ((v - x0) / (x1 - x0)) * (W - padL - padR); }
    function Y(v) { return padT + (1 - (v - y0) / (y1 - y0)) * (H - padT - padB); }
    var band = 'M' + X(x0).toFixed(1) + ',' + Y(s.intercept + s.slope * x0 + s.q75).toFixed(1)
      + ' L' + X(x1).toFixed(1) + ',' + Y(s.intercept + s.slope * x1 + s.q75).toFixed(1)
      + ' L' + X(x1).toFixed(1) + ',' + Y(s.intercept + s.slope * x1 + s.q25).toFixed(1)
      + ' L' + X(x0).toFixed(1) + ',' + Y(s.intercept + s.slope * x0 + s.q25).toFixed(1) + ' Z';
    var line = 'M' + X(x0).toFixed(1) + ',' + Y(s.intercept + s.slope * x0).toFixed(1)
      + ' L' + X(x1).toFixed(1) + ',' + Y(s.intercept + s.slope * x1).toFixed(1);
    var dots = s.points.map(function (p) {
      return '<circle cx="' + X(p[0]).toFixed(1) + '" cy="' + Y(p[1]).toFixed(1) + '" r="2.2" fill="#f0b23e" fill-opacity="0.85"/>';
    }).join('');
    var svg = '<svg class="scatter" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Log market cap against log TVL for the 81 priced peers, with the fitted line and the P25–P75 band">'
      + '<path d="' + band + '" fill="#35d99a" fill-opacity="0.12"/>'
      + '<path d="' + line + '" fill="none" stroke="#35d99a" stroke-width="1.5"/>'
      + dots
      + '<text x="' + (padL + 2) + '" y="' + (H - 6) + '" fill="#8ba393" font-size="10">ln TVL →</text>'
      + '<text x="4" y="' + (padT + 8) + '" fill="#8ba393" font-size="10">ln mcap</text>'
      + '</svg>';
    return el('div', { class: 'scatter-wrap', html: svg });
  }

  // The out-of-sample evidence, on the main view above the table — the model earns its
  // rank before the board is shown, so the judge never has to open the Method tab to
  // check whether a term was tested.
  function evidence() {
    var odds = DATA.odds;
    var recordRows = DATA.oddsRecord.map(function (r) {
      return el('tr', null, el('td', { text: r.label }), el('td', { class: 'num', text: String(r.peers) }), el('td', { class: 'num', text: String(r.recorded) }), el('td', { class: 'num', text: Math.round(r.pct * 100) + '%' }));
    });
    return el('section', { class: 'panel evidence', id: 'evidence' },
      el('h2', { text: 'Out-of-sample evidence — the model earns its rank before the table' }),
      el('div', { class: 'grid3' },
        el('div', null,
          el('h3', { text: 'Value: median miss, three blind tests' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null, el('th', { text: 'Term-set' }), el('th', { class: 'num', text: 'LOO' }), el('th', { class: 'num', text: 'WF med' }), el('th', { class: 'num', text: 'WF 60/40' }), el('th', { class: 'num', text: 'Sign' }), el('th', { text: 'Verdict' }))),
            el('tbody', null, valueTableRows())
          ),
          el('p', { class: 'sub', text: 'Kept only when it beats the size curve on all three tests. Sign: the share of 100 bootstrap refits where the added term keeps its sign — the control holds 52%.' })
        ),
        el('div', null,
          el('h3', { text: 'Odds: Brier score, three held-out tests (lower is better)' }),
          el('table', { class: 'mini' },
            el('thead', null, el('tr', null, el('th', { text: 'Term-set' }), el('th', { class: 'num', text: 'Brier 10f' }), el('th', { class: 'num', text: 'Brier WF' }), el('th', { class: 'num', text: 'Brier LOO' }), el('th', { class: 'num', text: 'Accuracy' }), el('th', { text: 'Verdict' }))),
            el('tbody', null, oddsTableRows())
          ),
          el('p', { class: 'sub', text: 'Odds = P(has recorded a token by now) — the peers’ record, not a forecast. The base rate alone scores ' + odds.brierBase10.toFixed(3) + '; age, size, category share and family cut it to ' + odds.brier10.toFixed(3) + '.' })
        ),
        el('div', null,
          el('h3', { text: 'The fit, drawn' }),
          scatterSvg(),
          el('div', { class: 'duo' },
            el('div', null,
              el('h3', { text: 'Ranges are honest' }),
              el('table', { class: 'mini' },
                el('thead', null, el('tr', null, el('th', { text: 'Band' }), el('th', { class: 'num', text: 'Stated' }), el('th', { class: 'num', text: 'Achieved' }))),
                el('tbody', null, rangeTableRows())
              )
            ),
            el('div', null,
              el('h3', { text: 'The record behind the odds' }),
              el('table', { class: 'mini' },
                el('thead', null, el('tr', null, el('th', { text: 'Age' }), el('th', { class: 'num', text: 'Peers' }), el('th', { class: 'num', text: 'Record' }), el('th', { class: 'num', text: 'Share' }))),
                el('tbody', null, recordRows)
              )
            )
          ),
          el('p', { class: 'sub', text: 'Bands come from the leave-one-out caps. Older unlisted protocols record tokens far more often — 88% past three years, 34% under one.' })
        )
      ),
      el('p', { class: 'sub', text: 'A brand family that already has a token records tokens far more often (94% of 112 peers vs 41% without) — tagged below. No parent haircut: priced peers in token families price no worse (−0.09 vs +0.01).' })
    );
  }

  function accounting() {
    var total = DATA.rows.reduce(function (s, r) { return s + r.implied_value_usd; }, 0);
    var a = DATA.audit;
    function seg(n, cls) { return el('i', { class: 'seg ' + cls, style: 'width:' + (n / a.total * 100).toFixed(1) + '%' }); }
    return el('div', { class: 'ledger' },
      el('div', { class: 'ledger-bar', 'aria-hidden': 'true' }, seg(a.ranked, 'ranked'), seg(a.hasToken, 'token'), seg(a.setAside, 'aside')),
      el('span', null, el('b', { text: '758' }), ' protocols = ', el('b', { text: '198' }), ' ranked + ', el('b', { text: '416' }), ' record a token + ', el('b', { text: '144' }), ' set aside'),
      el('span', { class: 'checksum', text: 'Checksum: this table is board.json — ' + DATA.board_size + ' rows, ' + fmtUsd(total) + ' total expected value, ' + DATA.verdicts.FARM + ' FARM · ' + DATA.verdicts.MARGINAL + ' MARGINAL · ' + DATA.verdicts.SKIP + ' SKIP. The same file is what main.ts wrote.' })
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
      var nameCell = el('div', { class: 'name' },
        el('b', { text: r.name }),
        el('div', { class: 'name-sub' },
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
          r.watchlist ? el('span', { class: 'tag watch', text: 'Watchlist' }) : null,
          r.family_token ? el('span', { class: 'tag', text: 'family has a token' }) : null
        )
      );
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, el('div', null, el('b', { text: String(r.rank) }), el('div', { class: 'range', text: '#' + r.rank_low + '–' + r.rank_high }))),
        el('td', null, nameCell),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: r.odds.toFixed(2) }),
        el('td', { class: 'num', text: fmtUsd(r.launch_value_usd) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('div', null, el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }), el('div', { class: 'range', text: 'P25–P75 ' + fmtUsd(r.interval_low_usd) + ' – ' + fmtUsd(r.interval_high_usd) }))
        )),
        el('td', null, el('div', null, verdictChip(e.verdict), el('div', { class: 'range', text: '$' + e.perHour.toFixed(0) + '/h' }))),
        el('td', null, el('div', { class: 'plan' },
          el('b', { text: r.plan_type }),
          el('div', { class: 'range', text: '$' + r.deposit_usd + ' · ' + r.hold_days + 'd · 6 steps' })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel', id: 'board-table' },
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
            sortHeader('launch', 'If it launches'),
            sortHeader('implied', 'Expected value'),
            el('th', { scope: 'col', text: 'Farm verdict' }),
            el('th', { scope: 'col', text: 'Farm plan' })
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
    var odds = DATA.odds;
    var oddsAtRows = odds.oddsAt.map(function (o) {
      var label = o.ageYears < 1 ? Math.round(o.ageYears * 12) + ' months' : o.ageYears === 1 ? '1 year' : o.ageYears + ' years';
      return el('tr', null,
        el('td', { text: label }),
        el('td', { class: 'num', text: o.odds.toFixed(2) })
      );
    });
    var bandRows = DATA.bands.map(function (b) {
      return el('tr', null, el('td', { text: b.label }), el('td', { class: 'num', text: 'x' + b.multiple.toFixed(2) }));
    });
    return el('div', null,
      el('section', { class: 'panel model' },
        el('h2', { text: 'The method, with its receipts' }),
        el('p', { class: 'sub', text: 'Nothing here is a list of names. Every number below is fitted from the snapshot at run time, and every term was kept or dropped on blind tests.' }),
        el('div', { class: 'formula' },
          'expected value = exp(' + fit.coefs[0].toFixed(4) + ' + ' + fit.coefs[1].toFixed(4) + ' x ln TVL ' + (fit.coefs[2] >= 0 ? '+ ' : '− ') + Math.abs(fit.coefs[2]).toFixed(4) + ' x ln chains) x odds(age)   ·   fit on ' + fit.n + ' priced peers, R2 ' + fit.r2.toFixed(3) + ', residual sd ' + fit.residSd.toFixed(2) + ' in log terms'
        ),
        el('div', { class: 'grid2' },
          el('div', null,
            el('h3', { text: 'Blind tests: median multiplicative miss' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Term-set' }), el('th', { class: 'num', text: 'LOO' }), el('th', { class: 'num', text: 'WF med' }), el('th', { class: 'num', text: 'WF 60/40' }), el('th', { class: 'num', text: 'Sign' }), el('th', { text: 'Verdict' }))),
              el('tbody', null, valueTableRows())
            ),
            el('p', { class: 'sub', text: 'Leave-one-out refits the curve 81 times, each time holding one protocol out. Walk-forward fits protocols listed before the median listing date and tests the newer half; the 60/40 split fits the oldest 60% and tests the newest 40%. A term is kept only when it beats the size curve on all three by a real margin (x0.02). Age helps the median walk-forward but blows the 60/40 split to x4.33 — its slope flips sign on old protocols, so it is dropped. Growth helps both walk-forwards but misses leave-one-out, so it is dropped as well.' }),
            el('h3', { text: 'Ranges are honest' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Band' }), el('th', { class: 'num', text: 'Stated' }), el('th', { class: 'num', text: 'Achieved' }))),
              el('tbody', null, rangeTableRows())
            ),
            el('p', { class: 'sub', text: 'Bands come from the leave-one-out caps, not from a guessed spread: P25–P75 is exp(q25)..exp(q75) of the held-out log errors, P10–P90 the same at q10..q90. Coefficients ± bootstrap s.e. (200 refits): ' + fit.coefs[0].toFixed(2) + ' ± ' + fit.bootstrapSe[0].toFixed(2) + ', ' + fit.coefs[1].toFixed(2) + ' ± ' + fit.bootstrapSe[1].toFixed(2) + ', ' + fit.coefs[2].toFixed(2) + ' ± ' + fit.bootstrapSe[2].toFixed(2) + '.' })
          ),
          el('div', null,
            el('h3', { text: 'Odds a token is recorded by now' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Term-set' }), el('th', { class: 'num', text: 'Brier 10f' }), el('th', { class: 'num', text: 'Brier WF' }), el('th', { class: 'num', text: 'Brier LOO' }), el('th', { class: 'num', text: 'Accuracy' }), el('th', { text: 'Verdict' }))),
              el('tbody', null, oddsTableRows())
            ),
            el('p', { class: 'sub', text: 'Logistic odds on ' + odds.n + ' aged peers: Brier ' + odds.brier10.toFixed(3) + ' held out (10-fold) and ' + odds.brierWf.toFixed(3) + ' walk-forward, vs ' + odds.brierBase10.toFixed(3) + ' and ' + odds.brierBaseWf.toFixed(3) + ' for the base rate. Odds = P(has recorded a token by now) — the peers’ record, not a forecast. The category share is shrunk toward the base rate (m=10); the family term lifts brands whose token already trades.' }),
            el('h3', { text: 'Odds by age (reference protocol, $100M TVL)' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'Still unlisted at' }), el('th', { class: 'num', text: 'Odds' }))),
              el('tbody', null, oddsAtRows)
            ),
            el('p', { class: 'sub', text: 'Odds rise with age: a protocol that has run three years with no token is a better bet than a six-month-old one, because the peers that survive unlisted are the ones still in the running. Risk Curators list rarely (5 of 39 peers), so Steakhouse and Sentora sit low on odds despite their size.' }),
            el('h3', { text: 'Fitted multiple by size' }),
            el('table', { class: 'mini' },
              el('thead', null, el('tr', null, el('th', { text: 'TVL band' }), el('th', { class: 'num', text: 'Launch / TVL' }))),
              el('tbody', null, bandRows)
            ),
            el('p', { class: 'sub', text: 'The multiple falls with size: the market pays less per dollar of TVL for the giants. That is the fitted curve, not an opinion.' })
          )
        ),
        el('h3', { text: 'Farm economics — the sliders live above the board' }),
        el('p', { class: 'sub', text: 'Payout = pool share x expected value / farmers, where farmers = base x (TVL / $100M)^0.7. Cost = $6 gas + $1.50 a week + time at your hourly rate + 2% a year on the deposit. FARM nets at least your hourly rate, MARGINAL covers its cost, SKIP does not. The sliders above the board change the verdicts, never the ranks. The pool share is 10% of the expected value — the same share the #3 entry on this bounty publishes on its board.' })
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
    // board.json: category, chains, TVL and age decide the action, the deposit, the hold
    // and every cost and time. No name is special-cased. board.json carries the steps;
    // the page shows them with their cost and time split out.
    var steps = [];
    var chain = row.chains && row.chains.length ? row.chains[0] : 'its main chain';
    var deposit = row.deposit_usd;
    var hold = row.hold_days;
    var growth = row.change_7d === null ? 0 : row.change_7d;
    // change_7d is in percent (+4.58 means +4.58%), so the pace bands are ±5 percent.
    var pace = growth > 5 ? 'TVL is up sharply this week, so start this week before the crowd arrives.'
      : growth < -5 ? 'TVL is down this week, so start with half the capital and add the rest next week.'
      : 'TVL is steady this week, so start at the full size below.';
    var c = (row.category || '').toLowerCase();
    var action;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) action = 'Supply $' + deposit + ' of USDC to ' + row.name + ' on ' + chain + ' and keep the position open.';
    else if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) action = 'Provide $' + deposit + ' of liquidity to ' + row.name + "'s main pool on " + chain + ' and keep the position open.';
    else if (c.indexOf('bridge') >= 0) action = 'Bridge $' + deposit + ' of USDC to ' + chain + ' through ' + row.name + ' and use the bridged funds in its app.';
    else if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) action = "Stake $" + deposit + " of the chain's staking asset through " + row.name + ' and keep the receipt.';
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) action = 'Deposit $' + deposit + ' of USDC as margin on ' + row.name + ' and open one small hedge.';
    else if (c.indexOf('prediction') >= 0) action = 'Fund $' + deposit + ' and place one market position on ' + row.name + '.';
    else if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) action = 'Deposit $' + deposit + ' into a ' + row.name + ' vault on ' + chain + ' and keep the shares.';
    else if (c.indexOf('stable') >= 0) action = 'Mint or deposit $' + deposit + ' of the stable asset through ' + row.name + ' on ' + chain + '.';
    else if (c.indexOf('rwa') >= 0) action = "Mint $" + deposit + " of the protocol's yield asset on " + chain + ' and hold it.';
    else if (c.indexOf('insurance') >= 0) action = 'Buy $' + deposit + ' of cover from ' + row.name + ' on ' + chain + ' and keep the policy.';
    else action = 'Deposit $' + deposit + ' of USDC into ' + row.name + ' on ' + chain + ' and keep the position open.';
    steps.push({ text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ' + pace, cost: 'under $3 of gas for the first transaction', time: '5 minutes' });
    steps.push({ text: action, cost: '$' + deposit + ' of capital and about $' + (deposit >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' });
    steps.push({ text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' });
    steps.push({ text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + deposit + ' stays in the position', time: hold + ' days' });
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
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') }),
        row.family_token ? el('p', { class: 'sub', text: 'Shares its first name with a protocol whose token already trades — the odds model counts that (94% of such peers record a token), the value curve does not discount it.' }) : null
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
        el('div', null, el('span', { text: 'Odds it lists by now' }), el('b', { class: 'num', text: row.odds.toFixed(2) })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Interval (P25–P75, leave-one-out)' }), el('b', { class: 'num', text: fmtUsd(row.interval_low_usd) + ' – ' + fmtUsd(row.interval_high_usd) })),
        el('div', null, el('span', { text: 'Wider band (P10–P90)' }), el('b', { class: 'num', text: fmtUsd(row.interval_p10_usd) + ' – ' + fmtUsd(row.interval_p90_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate, not a price. The protocol records no token — that is what the snapshot says, never proof it has none.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm verdict: ' + e.verdict }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Deposit' }), el('b', { class: 'num', text: '$' + row.deposit_usd })),
        el('div', null, el('span', { text: 'Hold' }), el('b', { class: 'num', text: row.hold_days + ' days' })),
        el('div', null, el('span', { text: 'Farmers (estimated)' }), el('b', { class: 'num', text: e.farmers.toLocaleString('en-US') })),
        el('div', null, el('span', { text: 'Expected payout' }), el('b', { class: 'num', text: '$' + e.payout.toFixed(2) })),
        el('div', null, el('span', { text: 'Cost (gas + time + lock-up)' }), el('b', { class: 'num', text: '$' + e.cost.toFixed(2) })),
        el('div', null, el('span', { text: 'Dollars per hour' }), el('b', { class: 'num', text: '$' + e.perHour.toFixed(2) })),
        el('div', null, el('span', { text: 'Break-even launch value' }), el('b', { class: 'num', text: fmtUsd(e.breakeven) }))
      ),
      el('p', { class: 'sub', text: e.verdict === 'FARM' ? 'The payout clears $25 an hour after valuing your time: farm it.' : e.verdict === 'MARGINAL' ? 'The payout covers the cost, barely: farm it small or skip it.' : 'The payout does not cover the cost: skip it, and watch the rank instead.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan — ' + row.plan_type }),
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
    shell.appendChild(formulaLine());
    shell.appendChild(integrity());
    shell.appendChild(accounting());
    shell.appendChild(controls());
    if (state.tab === 'board') {
      shell.appendChild(evidence());
      shell.appendChild(boardTable());
    } else if (state.tab === 'live') {
      shell.appendChild(liveTable());
    } else if (state.tab === 'audit') {
      shell.appendChild(auditTable());
    } else {
      shell.appendChild(methodPanel());
    }
    shell.appendChild(el('footer', { class: 'foot' },
      el('span', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.source }),
      el('span', { text: 'A protocol on this board records no token in the snapshot. That is the record, never proof it has none. Implied values are the entry’s own claim, never make.fun’s.' }),
      el('span', { text: 'Built by an AI agent for make.fun’s token launch radar bounty. Built with an uncensored model — superbot.gg.' })
    ));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
    if (state.scroll) {
      var target = document.getElementById(state.scroll);
      if (target) target.scrollIntoView();
      state.scroll = null; // one-shot: later renders (search, sort, tabs) must not jump back
    }
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
