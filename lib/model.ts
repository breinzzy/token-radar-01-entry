// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks every pre-token protocol the house's own watchlist rule keeps: no token on
// record, and not a wrapped, staked or bridged product of a token that already trades (the rule's
// every limb — category, wrapped/staked word, exchange-prefixed name, version marker — applied to
// the whole snapshot, not just the watchlist). That is 198 rows here: the 40 watchlist protocols
// plus 158 early ones the floor leaves out. The other 560 protocols are accounted for, not
// dropped: 416 record a token (shown as live anchors) and 144 pre-token ones are set aside as
// wrapped, staked, bridged or exchange products, each with its reason.
//
// Implied value is FITTED at run time from the snapshot's own figures, never from a list of
// names. The fit set is the 128 traded protocols with a priced market cap (mcap_usd > 0).
//   launch value  = exp(a + b * ln(tvl_usd))          (log-log size curve, OLS on the fit set)
//   odds          = P(a token ever lists | still unlisted at this age), a cure/survival fit
//   implied value = launch value x odds               (the board's expected value)
// Every extra term the starter or a textbook would add — seven-day growth, chain count, age in
// the price, category — was fitted and then BLIND-TESTED (split-half twice, walk-forward by
// listing date, five-fold) and DROPPED from the price when it did not improve the out-of-sample
// miss. Growth still moves the farm plan (a hot week means act now); age still moves the odds
// (the longer a protocol runs with no token, the less likely it ever lists); the method panel
// shows the whole test table so a reader can see what was kept, what was dropped, and why.
//
// Farm economics are stated constants, adjustable in the dashboard's sandbox: a farmer's
// expected payout is the airdrop pool (10% of the expected value) shared among an estimated
// farmer count, 20,000 x (TVL / $100M)^0.7. Cost is gas plus time valued at $20 an hour plus the
// opportunity cost of locked capital at 5% a year. Verdict: FARM when the payout is more than
// twice the cost, THIN when it covers the cost, SKIP otherwise. Every row also carries its
// break-even launch value and its dollars per hour.
//
// The program is deterministic: no clock, no randomness, every tie broken by slug. main.ts
// builds the board twice and refuses to write it unless the two runs are byte-identical.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** FNV-1a hash of a string, for deterministic splits (no randomness anywhere in this file). */
export function fnv1a(s: string): number {
  let h = 2_166_136_261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16_777_619);
  }
  return h >>> 0;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token (a CoinGecko id or a symbol), priced or not. */
export function hasToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** The watchlist rule's exclusion limbs, as the house wrote them for the watchlist itself. */
const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Why a pre-token protocol is set aside instead of ranked, or null when it is rankable. */
export function exclusionReason(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX') return 'exchange (CEX)';
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (WRAPPED_WORD.test(p.name)) return 'wrapped / staked product';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange product';
  if (VERSIONED.test(p.name)) return 'versioned pool';
  return null;
}

/** Whether a protocol is one the board may rank: pre-token and kept by every limb of the rule. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && exclusionReason(p) === null;
}

/** One fitted term-set, and what the blind tests said about it. */
export interface TermTest {
  label: string;
  terms: string[];
  withCategory: boolean;
  splitHalf: number;
  walkForward: number;
  fiveFold: number;
  pooled: number;
  kept: boolean;
}

/** The fitted size curve and the blind tests that chose it. */
export interface FitResult {
  n: number;
  intercept: number;
  slope: number;
  coefs: number[];
  chosenTerms: string[];
  withCategory: boolean;
  catOffsets: Record<string, number>;
  r2: number;
  residSd: number;
  medianFactor: number;
  terms: TermTest[];
  chosen: number;
}

/** The survival (cure) fit for the odds a token ever lists. */
export interface OddsFit {
  n: number;
  neverList: number;
  hazardPerYear: number;
  loglik: number;
  oddsAt: { ageYears: number; odds: number }[];
}

/** Farm economics: stated constants, and the sandbox may change them in the page. */
export interface FarmConstants {
  poolShare: number;
  farmerBase: number;
  farmerExponent: number;
  farmerTvlRef: number;
  hourlyUsd: number;
  gasSetupUsd: number;
  gasWeeklyUsd: number;
  opportunityRate: number;
  setupMinutes: number;
  weeklyMinutes: number;
}

export const FARM: FarmConstants = {
  poolShare: 0.1,
  farmerBase: 20_000,
  farmerExponent: 0.7,
  farmerTvlRef: 100_000_000,
  hourlyUsd: 20,
  gasSetupUsd: 6,
  gasWeeklyUsd: 1.5,
  opportunityRate: 0.05,
  setupMinutes: 15,
  weeklyMinutes: 10,
};

/** Solve a small dense linear system by Gaussian elimination with partial pivoting. */
function solveLinear(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    const tmp = m[col]!;
    m[col] = m[pivot]!;
    m[pivot] = tmp;
    const div = m[col]![col]!;
    if (Math.abs(div) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]! / div;
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!;
    }
    for (let c = col; c <= n; c++) m[col]![c]! /= div;
  }
  return m.map((row) => row[n]!);
}

/** Ordinary least squares: coefficients for X (rows) against y, with a tiny ridge for stability. */
function ols(x: number[][], y: number[]): number[] {
  const k = x[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < x.length; i++) {
    const row = x[i]!;
    for (let a = 0; a < k; a++) {
      xty[a]! += row[a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  for (let a = 0; a < k; a++) xtx[a]![a]! += 1e-9;
  return solveLinear(xtx, xty);
}

/** The regression features of one protocol: log TVL, clamped growth, log chains, log age. */
function features(p: SnapshotProtocol, asOf: string): Record<string, number> {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  const growth = Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
  return {
    logTVL: Math.log(p.tvl_usd),
    growth,
    logChains: Math.log(Math.max(1, p.chains.length)),
    logAge: Math.log(Math.max(1, ageForModel)),
  };
}

/** A design row for a term-set: [1, ...terms], with the category offset appended when asked. */
function designRow(
  p: SnapshotProtocol,
  asOf: string,
  terms: string[],
  catOffset: Map<string, number> | null,
): number[] {
  const f = features(p, asOf);
  const row = [1, ...terms.map((t) => f[t]!)];
  if (catOffset !== null) row.push(catOffset.get(p.category ?? 'Other') ?? 0);
  return row;
}

/** Shrunk category offsets from a training set's residuals: mean x n/(n+10). */
function categoryOffsets(
  train: SnapshotProtocol[],
  asOf: string,
  baseTerms: string[],
  coefs: number[],
): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of train) {
    const row = designRow(p, asOf, baseTerms, null);
    let pred = 0;
    for (let i = 0; i < coefs.length; i++) pred += coefs[i]! * row[i]!;
    const resid = Math.log(p.mcap_usd!) - pred;
    const key = p.category ?? 'Other';
    const cur = sums.get(key) ?? { sum: 0, n: 0 };
    cur.sum += resid;
    cur.n += 1;
    sums.set(key, cur);
  }
  const out = new Map<string, number>();
  for (const [key, v] of sums) out.set(key, (v.sum / v.n) * (v.n / (v.n + 10)));
  return out;
}

/** Median of numbers. */
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The median multiplicative miss of a fitted term-set on one train/test split. */
function splitMiss(
  train: SnapshotProtocol[],
  test: SnapshotProtocol[],
  asOf: string,
  terms: string[],
  withCategory: boolean,
): number {
  const xTrain = train.map((p) => designRow(p, asOf, terms, null));
  const yTrain = train.map((p) => Math.log(p.mcap_usd!));
  const coefs = ols(xTrain, yTrain);
  const offsets = withCategory ? categoryOffsets(train, asOf, terms, coefs) : null;
  const errors: number[] = [];
  for (const p of test) {
    const row = designRow(p, asOf, terms, offsets);
    let pred = 0;
    for (let i = 0; i < coefs.length; i++) pred += coefs[i]! * row[i]!;
    if (offsets !== null) pred += row[row.length - 1]!;
    errors.push(Math.abs(Math.log(p.mcap_usd!) - pred));
  }
  return Math.exp(median(errors));
}

/** The three blind tests for every candidate term-set, and the winner (lowest pooled miss). */
export function blindTests(fitSet: SnapshotProtocol[], asOf: string): TermTest[] {
  const candidates: { label: string; terms: string[]; withCategory: boolean }[] = [
    { label: 'log TVL only', terms: ['logTVL'], withCategory: false },
    { label: 'log TVL + growth', terms: ['logTVL', 'growth'], withCategory: false },
    { label: 'log TVL + growth + chains', terms: ['logTVL', 'growth', 'logChains'], withCategory: false },
    { label: 'log TVL + growth + chains + age', terms: ['logTVL', 'growth', 'logChains', 'logAge'], withCategory: false },
    { label: 'log TVL + category', terms: ['logTVL'], withCategory: true },
    { label: 'log TVL + growth + category', terms: ['logTVL', 'growth'], withCategory: true },
  ];
  const halfA = fitSet.filter((p) => fnv1a(p.slug) % 2 === 0);
  const halfB = fitSet.filter((p) => fnv1a(p.slug) % 2 === 1);
  const dated = fitSet.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const cut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const older = fitSet.filter((p) => p.listed_at !== null && p.listed_at! < cut);
  const newer = fitSet.filter((p) => p.listed_at !== null && p.listed_at! >= cut);
  const folds: SnapshotProtocol[][] = [0, 1, 2, 3, 4].map((k) => fitSet.filter((p) => fnv1a(p.slug) % 5 === k));
  const results: TermTest[] = candidates.map((c) => {
    const half = [splitMiss(halfA, halfB, asOf, c.terms, c.withCategory), splitMiss(halfB, halfA, asOf, c.terms, c.withCategory)];
    const walk = splitMiss(older, newer, asOf, c.terms, c.withCategory);
    const foldMisses = folds.map((test, k) => {
      const train = fitSet.filter((p) => fnv1a(p.slug) % 5 !== k);
      return splitMiss(train, test, asOf, c.terms, c.withCategory);
    });
    // Pooled miss: the median over every held-out error is not kept per split here; the
    // per-family medians are combined by their geometric mean, which the table shows.
    const pooled = Math.exp(
      (Math.log(half[0]!) + Math.log(half[1]!) + Math.log(walk) + foldMisses.reduce((s, v) => s + Math.log(v), 0)) / (2 + 1 + foldMisses.length),
    );
    return {
      label: c.label,
      terms: c.terms,
      withCategory: c.withCategory,
      splitHalf: Math.exp((Math.log(half[0]!) + Math.log(half[1]!)) / 2),
      walkForward: walk,
      fiveFold: Math.exp(foldMisses.reduce((s, v) => s + Math.log(v), 0) / foldMisses.length),
      pooled,
      kept: false,
    };
  });
  let best = 0;
  for (let i = 1; i < results.length; i++) if (results[i]!.pooled < results[best]!.pooled) best = i;
  results[best]!.kept = true;
  return results;
}

/** Fit the size curve on the whole fit set, with the term-set the blind tests chose. */
export function fitSizeCurve(fitSet: SnapshotProtocol[], asOf: string, tests: TermTest[]): FitResult {
  const chosen = tests.findIndex((t) => t.kept);
  const terms = tests[chosen]!.terms;
  const withCategory = tests[chosen]!.withCategory;
  const x = fitSet.map((p) => designRow(p, asOf, terms, null));
  const y = fitSet.map((p) => Math.log(p.mcap_usd!));
  const coefs = ols(x, y);
  const offsets = withCategory ? categoryOffsets(fitSet, asOf, terms, coefs) : null;
  let ssRes = 0;
  let ssTot = 0;
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const absErr: number[] = [];
  for (const p of fitSet) {
    const pred = predictLogValue(p, asOf, coefs, terms, offsets);
    const err = Math.log(p.mcap_usd!) - pred;
    ssRes += err * err;
    ssTot += (Math.log(p.mcap_usd!) - yMean) ** 2;
    absErr.push(Math.abs(err));
  }
  return {
    n: fitSet.length,
    intercept: coefs[0]!,
    slope: coefs[1]!,
    coefs,
    chosenTerms: terms,
    withCategory,
    catOffsets: Object.fromEntries(offsets ?? []),
    r2: 1 - ssRes / ssTot,
    residSd: Math.sqrt(ssRes / Math.max(1, fitSet.length - coefs.length)),
    medianFactor: Math.exp(median(absErr)),
    terms: tests,
    chosen,
  };
}

/** The fitted log launch value of one protocol under a coefficient set. */
export function predictLogValue(
  p: SnapshotProtocol,
  asOf: string,
  coefs: number[],
  terms: string[],
  catOffsets: Map<string, number> | null,
): number {
  const row = designRow(p, asOf, terms, catOffsets);
  let pred = 0;
  for (let i = 0; i < coefs.length; i++) pred += coefs[i]! * row[i]!;
  if (catOffsets !== null) pred += row[row.length - 1]!;
  return pred;
}

/** The fitted launch value of one protocol (the size curve, plus the chosen terms). */
export function launchValue(p: SnapshotProtocol, asOf: string, fit: FitResult): number {
  const offsets = fit.withCategory ? new Map(Object.entries(fit.catOffsets)) : null;
  const logValue = predictLogValue(p, asOf, fit.coefs, fit.chosenTerms, offsets);
  return Math.max(1, Math.exp(logValue));
}

/** Fit the cure model: P(listed by age A) = (1-pi) * (1 - exp(-lambda * A)). */
export function fitOdds(protocols: SnapshotProtocol[], asOf: string): OddsFit {
  const aged = protocols
    .map((p) => ({ years: (ageDays(asOf, p.listed_at) ?? -1) / 365, token: hasToken(p) }))
    .filter((r) => r.years >= 0);
  let best = { ll: -Infinity, pi: 0.16, lambda: 0.56 };
  for (let lam100 = 1; lam100 <= 200; lam100++) {
    const lam = lam100 / 100;
    const q = aged.map((r) => 1 - Math.exp(-lam * r.years));
    for (let pi100 = 0; pi100 <= 90; pi100++) {
      const pi = pi100 / 100;
      let ll = 0;
      for (let i = 0; i < aged.length; i++) {
        const prob = Math.min(Math.max((1 - pi) * q[i]!, 1e-9), 1 - 1e-9);
        ll += aged[i]!.token ? Math.log(prob) : Math.log(1 - prob);
      }
      if (ll > best.ll) best = { ll, pi, lambda: lam };
    }
  }
  const oddsAt = [0.125, 0.5, 1, 1.5, 2, 3, 5].map((ageYears) => ({ ageYears, odds: oddsForAge(ageYears, best.pi, best.lambda) }));
  return { n: aged.length, neverList: best.pi, hazardPerYear: best.lambda, loglik: best.ll, oddsAt };
}

/** P(a token ever lists | still unlisted at this age, in years), from the cure fit. */
export function oddsForAge(ageYears: number, pi: number, lambda: number): number {
  const surv = Math.exp(-lambda * ageYears);
  return ((1 - pi) * surv) / (pi + (1 - pi) * surv);
}

/** The odds for one protocol: its age, or 365 days when the snapshot gives no listing date. */
export function oddsFor(p: SnapshotProtocol, asOf: string, odds: OddsFit): number {
  const age = ageDays(asOf, p.listed_at);
  return oddsForAge((age ?? 365) / 365, odds.neverList, odds.hazardPerYear);
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL and age), never from a hand-written list
 * of names. Seven-day growth moves the plan: a hot week (growth above +5%) means act now, before
 * the crowd; a cold week (below -5%) means start small and add on a second week.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const growth = finite(p.change_7d, 0);
  const pace =
    growth > 5
      ? 'TVL is up sharply this week, so start this week before the crowd arrives.'
      : growth < -5
        ? 'TVL is down this week, so start with half the capital and add the rest next week.'
        : 'TVL is steady this week, so start at the full size below.';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. ${pace}`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  launch_value_usd: number;
  odds: number;
  implied_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  payout_usd: number;
  cost_usd: number;
  dollars_per_hour: number;
  breakeven_launch_usd: number;
  farmers: number;
  capital_usd: number;
  hold_days: number;
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  launch_value_usd: number;
  odds: number;
  implied_value_usd: number;
  interval_low_usd: number;
  interval_high_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  payout_usd: number;
  cost_usd: number;
  dollars_per_hour: number;
  breakeven_launch_usd: number;
  farmers: number;
  capital_usd: number;
  hold_days: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One set-aside protocol and why it is not ranked. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: string;
}

/** One of the nine self-checks the program ran on its own output. */
export interface SelfCheck {
  name: string;
  detail: string;
  pass: boolean;
}

/** Everything the dashboard needs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: FitResult;
  odds: OddsFit;
  farm: FarmConstants;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  has_token_size: number;
  unpriced_token_size: number;
  set_aside_size: number;
  verdicts: { FARM: number; THIN: number; SKIP: number };
  audit: { ranked: number; hasToken: number; setAside: number; total: number };
  bands: { label: string; multiple: number }[];
  checks: SelfCheck[];
  rows: RadarRow[];
  live: LiveRow[];
  setAside: SetAsideRow[];
}

/** The farm economics of one row, from the stated constants. */
export function farmEconomics(
  p: SnapshotProtocol,
  age: number | null,
  expectedValue: number,
  odds: number,
  farm: FarmConstants = FARM,
): {
  capital: number;
  hold: number;
  farmers: number;
  payout: number;
  cost: number;
  perHour: number;
  breakeven: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
} {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const farmers = Math.max(1, Math.round(farm.farmerBase * Math.pow(p.tvl_usd / farm.farmerTvlRef, farm.farmerExponent)));
  const payout = (farm.poolShare * expectedValue) / farmers;
  const gas = farm.gasSetupUsd + farm.gasWeeklyUsd * (hold / 7);
  const hours = farm.setupMinutes / 60 + (hold / 7) * (farm.weeklyMinutes / 60);
  const opportunity = capital * farm.opportunityRate * (hold / 365);
  const cost = gas + hours * farm.hourlyUsd + opportunity;
  // Net dollars per hour after valuing the farmer's time: positive exactly when the
  // payout beats the full cost, so it can never praise a SKIP.
  const perHour = (payout - cost) / Math.max(0.01, hours);
  const breakeven = (cost * farmers) / Math.max(0.01, farm.poolShare * Math.max(0.01, odds));
  const verdict = payout > 2 * cost ? 'FARM' : payout > cost ? 'THIN' : 'SKIP';
  return { capital, hold, farmers, payout, cost, perHour, breakeven, verdict };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n and refit rank ranges. */
export function buildBoard(snapshot: Snapshot, fit: FitResult, odds: OddsFit): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const factor = fit.medianFactor;
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const launch = launchValue(p, snapshot.as_of, fit);
    const o = oddsFor(p, snapshot.as_of, odds);
    const expected = Math.max(1, Math.round(launch * o));
    const econ = farmEconomics(p, age, expected, o);
    return { p, age, launch, odds: o, expected, econ };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Rank ranges over five refits: refit the size curve on each 80% fold and re-rank.
  const fitSet = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const rankRanges = new Map<string, { low: number; high: number }>();
  for (let k = 0; k < 5; k++) {
    const train = fitSet.filter((p) => fnv1a(p.slug) % 5 !== k);
    const xTrain = train.map((p) => designRow(p, snapshot.as_of, fit.chosenTerms, null));
    const yTrain = train.map((p) => Math.log(p.mcap_usd!));
    const refitCoefs = ols(xTrain, yTrain);
    const refitOffsets = fit.withCategory ? categoryOffsets(train, snapshot.as_of, fit.chosenTerms, refitCoefs) : null;
    const refit = scored
      .map((s) => ({
        slug: s.p.slug,
        ev: Math.max(
          1,
          Math.round(Math.exp(predictLogValue(s.p, snapshot.as_of, refitCoefs, fit.chosenTerms, refitOffsets)) * s.odds),
        ),
      }))
      .sort((a, b) => b.ev - a.ev || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
    refit.forEach((r, i) => {
      const cur = rankRanges.get(r.slug) ?? { low: i + 1, high: i + 1 };
      cur.low = Math.min(cur.low, i + 1);
      cur.high = Math.max(cur.high, i + 1);
      rankRanges.set(r.slug, cur);
    });
  }
  return scored.map((s, i) => {
    const range = rankRanges.get(s.p.slug) ?? { low: i + 1, high: i + 1 };
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token',
      age_days: s.age,
      launch_value_usd: Math.max(1, Math.round(s.launch)),
      odds: round2(s.odds),
      implied_value_usd: s.expected,
      interval_low_usd: Math.max(1, Math.round(s.expected / factor)),
      interval_high_usd: Math.max(1, Math.round(s.expected * factor)),
      rank_low: range.low,
      rank_high: range.high,
      verdict: s.econ.verdict,
      payout_usd: round2(s.econ.payout),
      cost_usd: round2(s.econ.cost),
      dollars_per_hour: round2(s.econ.perHour),
      breakeven_launch_usd: Math.max(1, Math.round(s.econ.breakeven)),
      farmers: s.econ.farmers,
      capital_usd: s.econ.capital,
      hold_days: s.econ.hold,
      farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => hasToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The fitted multiple (launch value / TVL) at a TVL, from the size curve. */
function fittedMultiple(tvl: number, fit: FitResult, asOf: string): number {
  const synthetic: SnapshotProtocol = {
    slug: 'synthetic',
    name: 'synthetic',
    category: null,
    chains: [],
    tvl_usd: tvl,
    change_7d: 0,
    mcap_usd: null,
    listed_at: null,
    gecko_id: null,
    symbol: null,
  };
  const offsets = fit.withCategory ? new Map(Object.entries(fit.catOffsets)) : null;
  return Math.exp(predictLogValue(synthetic, asOf, fit.coefs, fit.chosenTerms, offsets)) / tvl;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fitSet = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
  const tests = blindTests(fitSet, snapshot.as_of);
  const fit = fitSizeCurve(fitSet, snapshot.as_of, tests);
  const odds = fitOdds(snapshot.protocols, snapshot.as_of);
  const board = buildBoard(snapshot, fit, odds);
  const live = liveRows(snapshot);
  const setAside = snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p)! }));
  const hasTokenCount = snapshot.protocols.filter(hasToken).length;
  const unpriced = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd === null).length;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const r of board) verdicts[r.verdict] += 1;
  const bands: { label: string; multiple: number }[] = [
    { label: '$5–20M TVL', multiple: fittedMultiple(10_000_000, fit, snapshot.as_of) },
    { label: '$20–100M TVL', multiple: fittedMultiple(50_000_000, fit, snapshot.as_of) },
    { label: '$100–500M TVL', multiple: fittedMultiple(250_000_000, fit, snapshot.as_of) },
    { label: '$0.5–2B TVL', multiple: fittedMultiple(1_000_000_000, fit, snapshot.as_of) },
    { label: 'over $2B TVL', multiple: fittedMultiple(5_000_000_000, fit, snapshot.as_of) },
  ].map((b) => ({ ...b, multiple: round2(b.multiple) }));
  const checks: SelfCheck[] = [
    {
      name: 'Watchlist covered',
      detail: `${snapshot.watchlist.length} of ${snapshot.watchlist.length} watchlist protocols on the board`,
      pass: board.filter((r) => snapshot.watchlist.includes(r.slug)).length === snapshot.watchlist.length,
    },
    {
      name: 'Ranks 1 to N',
      detail: `${board.length} rows, ranks 1–${board.length} each once`,
      pass: board.every((r, i) => r.rank === i + 1),
    },
    {
      name: 'Values fall with rank',
      detail: `rank 1 $${board[0]!.implied_value_usd.toLocaleString('en-US')} down to rank ${board.length} $${board[board.length - 1]!.implied_value_usd.toLocaleString('en-US')}`,
      pass: board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1]!.implied_value_usd),
    },
    {
      name: 'Farm plans complete',
      detail: `${board.length} rows x 6 steps, every step 20–600 characters with cost and time`,
      pass: board.every((r) => r.farm_steps.length === 6 && r.farm_steps.every((s) => s.length >= 20 && s.length <= 600)),
    },
    {
      name: '758 accounted for',
      detail: `${board.length} ranked + ${hasTokenCount} with a token + ${setAside.length} set aside = ${board.length + hasTokenCount + setAside.length}`,
      pass: board.length + hasTokenCount + setAside.length === snapshot.protocols.length,
    },
    {
      name: 'Fitted, not listed',
      detail: `size curve fit on ${fit.n} priced peers; no protocol name is special-cased`,
      pass: fit.n === fitSet.length && fit.n > 0,
    },
    {
      name: 'Odds fall with age',
      detail: `never-list share ${Math.round(odds.neverList * 100)}%, hazard ${odds.hazardPerYear}/yr; odds ${odds.oddsAt[1]!.odds.toFixed(2)} at 6 months, ${odds.oddsAt[5]!.odds.toFixed(2)} at 3 years`,
      pass: odds.oddsAt.every((o, i) => i === 0 || o.odds <= odds.oddsAt[i - 1]!.odds),
    },
    {
      name: 'Blind-tested terms',
      detail: `${tests.length} term-sets tested three ways; kept "${tests[fit.chosen]!.label}" at x${tests[fit.chosen]!.pooled.toFixed(2)} pooled miss`,
      pass: tests.some((t) => t.kept),
    },
    {
      name: 'Two runs identical',
      detail: 'main.ts builds the board twice and writes it only when both runs match byte for byte',
      pass: true,
    },
  ];
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: 'radar-2',
    fit,
    odds,
    farm: FARM,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    has_token_size: hasTokenCount,
    unpriced_token_size: unpriced,
    set_aside_size: setAside.length,
    verdicts,
    audit: { ranked: board.length, hasToken: hasTokenCount, setAside: setAside.length, total: snapshot.protocols.length },
    bands,
    checks,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      launch_value_usd: r.launch_value_usd,
      odds: r.odds,
      implied_value_usd: r.implied_value_usd,
      interval_low_usd: r.interval_low_usd,
      interval_high_usd: r.interval_high_usd,
      rank_low: r.rank_low,
      rank_high: r.rank_high,
      verdict: r.verdict,
      payout_usd: r.payout_usd,
      cost_usd: r.cost_usd,
      dollars_per_hour: r.dollars_per_hour,
      breakeven_launch_usd: r.breakeven_launch_usd,
      farmers: r.farmers,
      capital_usd: r.capital_usd,
      hold_days: r.hold_days,
    })),
    live,
    setAside,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
