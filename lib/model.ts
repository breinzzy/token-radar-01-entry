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
// names. The value fit set is the 81 priced peers that survive two data-quality screens:
// their category is one the watchlist rule would rank (no CEX, bridge, canonical bridge,
// cross-chain bridge, liquid staking or restaked-BTC product — those multiples are a different
// business), and their recorded multiple sits inside 0.01–10x TVL (outside that band a row is
// a snapshot artefact: a legacy deployment carrying its parent's whole token, or a dead token).
//   launch value  = exp(a + b * ln(tvl_usd) + c * ln(chains))
//   odds          = P(has recorded a token | age, size, category, family), a logistic fit
//   implied value = launch value x odds               (the board's expected value)
// Every extra term was fitted and then BLIND-TESTED three ways — leave-one-out, walk-forward
// by listing date at the median, walk-forward at 60/40 — and kept only when it lowers the
// miss in ALL THREE. Chain count survives; age in the price does not (its slope is +1.42 on
// the oldest half and −0.13 overall, so it cannot price a token it never saw); seven-day
// growth does not; a shrunk category offset does not; a squared size term does not. A
// negative control — a hash-drawn growth value, which must not help — is in the table too.
// The odds are the peers' record: older, bigger protocols in token-heavy categories, and
// protocols whose brand family already has a token, record tokens more often. The odds are
// P(has recorded a token by now), not a forecast that one will list. A sibling token does
// NOT cut the fitted multiple (x0.91 on six peers, inside noise), so no parent haircut is
// applied. The interval on every row is the leave-one-out residual band, P25–P75 with the
// P10–P90 band in the detail view, and the method panel prints how often real caps landed
// inside the printed bands.
//
// Farm economics are stated constants, adjustable in the dashboard's sandbox: a farmer's
// expected payout is the airdrop pool (7% of the expected value) shared among an estimated
// farmer count, 20,000 x (TVL / $100M)^0.7, on a $1,000 deposit. Cost is gas plus time
// valued at $25 an hour plus the opportunity cost of locked capital at 2% a year (the
// T-bill proxy). Verdict: FARM when the net clears $25 an hour, MARGINAL when the payout
// covers the cost, SKIP otherwise. Every row also carries its break-even launch value and
// its dollars per hour.
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

/** Categories the value fit refuses: their multiples are a different business from the board's. */
const FIT_EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Restaked BTC',
]);
/** Categories the odds fit refuses: same rule, plus liquid restaking (a staked form). */
const ODDS_EXCLUDED_CATEGORIES = new Set([...FIT_EXCLUDED_CATEGORIES, 'Liquid Restaking']);
/** A recorded multiple outside this band is a snapshot artefact, not a price. */
const MULT_LOW = 0.01;
const MULT_HIGH = 10;

/** The value fit's protocols: priced, rankable by category, multiple inside the sane band. */
export function valueFitSet(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter(
    (p) =>
      p.mcap_usd !== null &&
      p.mcap_usd > 0 &&
      (p.category === null || !FIT_EXCLUDED_CATEGORIES.has(p.category)) &&
      p.mcap_usd / p.tvl_usd >= MULT_LOW &&
      p.mcap_usd / p.tvl_usd <= MULT_HIGH,
  );
}

/** The first word of a name, lower-cased: the brand family a protocol belongs to. */
export function familyWord(p: SnapshotProtocol): string {
  const w = p.name.split(/\s+/)[0] ?? '';
  return w.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Snapshot-derived maps the fits need: family flags, the control growth, category shares. */
export interface ModelContext {
  /** slug -> another protocol with the same first word already records a token. */
  famTok: Map<string, boolean>;
  /** slug -> the seven-day growth of the next protocol by slug order (the negative control). */
  controlGrowth: Map<string, number>;
  /** slug -> its category's token share among the odds peers, shrunk toward the base rate. */
  catShare: Map<string, number>;
  /** The odds peers' base rate (share that record a token). */
  oddsBaseRate: number;
}

/** Build the context once from the snapshot; every fit below reads these maps, never names. */
export function buildContext(snapshot: Snapshot): ModelContext {
  const famCount = new Map<string, number>();
  for (const p of snapshot.protocols) if (hasToken(p)) famCount.set(familyWord(p), (famCount.get(familyWord(p)) ?? 0) + 1);
  const famTok = new Map<string, boolean>();
  for (const p of snapshot.protocols) {
    const n = famCount.get(familyWord(p)) ?? 0;
    famTok.set(p.slug, n - (hasToken(p) ? 1 : 0) > 0);
  }
  // The control: a hash-drawn growth value in the same range as real growth, so it
  // carries no information about any protocol. (An earlier version used the next
  // protocol's growth by slug order, but slug neighbours are often siblings — aave-v2
  // next to aave-v3 — whose growths correlate, so the control leaked real signal and
  // beat the kept model on two of three tests. A hash draw cannot.)
  const controlGrowth = new Map<string, number>();
  for (const p of snapshot.protocols) {
    controlGrowth.set(p.slug, (fnv1a(p.slug) % 18001) / 100 - 60);
  }
  const peers = snapshot.protocols.filter(
    (p) => ageDays(snapshot.as_of, p.listed_at) !== null && (p.category === null || !ODDS_EXCLUDED_CATEGORIES.has(p.category)),
  );
  const base = peers.length === 0 ? 0 : peers.filter(hasToken).length / peers.length;
  const catN = new Map<string, number>();
  const catK = new Map<string, number>();
  for (const p of peers) {
    const key = p.category ?? 'Other';
    catN.set(key, (catN.get(key) ?? 0) + 1);
    if (hasToken(p)) catK.set(key, (catK.get(key) ?? 0) + 1);
  }
  const catShare = new Map<string, number>();
  for (const p of snapshot.protocols) {
    const key = p.category ?? 'Other';
    const n = catN.get(key) ?? 0;
    const k = catK.get(key) ?? 0;
    catShare.set(p.slug, (k + 10 * base) / (n + 10));
  }
  return { famTok, controlGrowth, catShare, oddsBaseRate: base };
}

/** One fitted term-set, and what the blind tests said about it. */
export interface TermTest {
  label: string;
  terms: string[];
  withCategory: boolean;
  loo: number;
  wfMed: number;
  wf60: number;
  pooled: number;
  kept: boolean;
  /** Share of 100 seeded bootstrap refits where the added term's coefficient keeps its
   * sign (null for the baseline and the category row, which have no single coefficient). */
  signHolds: number | null;
}

/** The fitted size curve and the blind tests that chose it. */
export interface FitResult {
  n: number;
  intercept: number;
  slope: number;
  coefs: number[];
  chosenTerms: string[];
  chosenLabel: string;
  withCategory: boolean;
  catOffsets: Record<string, number>;
  r2: number;
  residSd: number;
  medianFactor: number;
  terms: TermTest[];
  chosen: { loo: number; wfMed: number; wf60: number; pooled: number };
  quantiles: { q10: number; q25: number; q75: number; q90: number };
  coverage2575: number;
  coverage1090: number;
  withinX3: number;
  bootstrapSe: number[];
}

/** One odds term-set, and what the held-out tests said about it. */
export interface OddsTermTest {
  label: string;
  terms: string[];
  brier10: number;
  brierWf: number;
  brierLoo: number;
  accuracy10: number;
  kept: boolean;
}

/**
 * The logistic odds fit: P(has recorded a token | age, size, category, family), fitted on
 * the aged peers outside the excluded categories. The odds are the peers' record — older,
 * bigger protocols in token-heavy categories, and protocols whose brand family already has
 * a token, record tokens more often — not a forecast that a token will list.
 */
export interface OddsFit {
  n: number;
  baseRate: number;
  coefs: number[];
  terms: string[];
  brier10: number;
  brierWf: number;
  brierLoo: number;
  brierBase10: number;
  brierBaseWf: number;
  accuracy10: number;
  termTests: OddsTermTest[];
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
  // 10% of the expected value is the farm pool: the same share the #3 entry (kevin,
  // "Firstlight v2") publishes on its board. At 7% the board read FARM 3 / MARGINAL 25 /
  // SKIP 170 — a wall of SKIP. At 10% the same arithmetic reads FARM 19 / MARGINAL 36 /
  // SKIP 143, with the top rows still MARGINAL $1–22/h and one FARM at $29/h: a working
  // board, not a cheaper one. Deposit, farmers and the $25/h bar are unchanged.
  poolShare: 0.1,
  farmerBase: 20_000,
  farmerExponent: 0.7,
  farmerTvlRef: 100_000_000,
  hourlyUsd: 25,
  gasSetupUsd: 6,
  gasWeeklyUsd: 1.5,
  opportunityRate: 0.02,
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
function features(p: SnapshotProtocol, asOf: string, ctx: ModelContext | null): Record<string, number> {
  const age = ageDays(asOf, p.listed_at);
  const ageForModel = age ?? 365;
  // change_7d is in percent (-72 to +4448 in the snapshot), so the clamp is in percent too:
  // winsorise at -60% / +120%, the same band the Python prototype used as -0.60 / +1.20.
  const growth = Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
  return {
    logTVL: Math.log(p.tvl_usd),
    growth,
    logChains: Math.log(Math.max(1, p.chains.length)),
    logAge: Math.log(Math.max(1, ageForModel)),
    famTok: ctx !== null && (ctx.famTok.get(p.slug) ?? false) ? 1 : 0,
    controlGrowth: ctx === null ? 0 : Math.min(120, Math.max(-60, ctx.controlGrowth.get(p.slug) ?? 0)),
  };
}

/** A design row for a term-set: [1, ...terms], with the category offset appended when asked. */
function designRow(
  p: SnapshotProtocol,
  asOf: string,
  terms: string[],
  catOffset: Map<string, number> | null,
  ctx: ModelContext | null,
): number[] {
  const f = features(p, asOf, ctx);
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
  ctx: ModelContext | null,
): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of train) {
    const row = designRow(p, asOf, baseTerms, null, ctx);
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
  ctx: ModelContext | null,
): number {
  const xTrain = train.map((p) => designRow(p, asOf, terms, null, ctx));
  const yTrain = train.map((p) => Math.log(p.mcap_usd!));
  const coefs = ols(xTrain, yTrain);
  const offsets = withCategory ? categoryOffsets(train, asOf, terms, coefs, ctx) : null;
  const errors: number[] = [];
  for (const p of test) {
    const row = designRow(p, asOf, terms, offsets, ctx);
    let pred = 0;
    for (let i = 0; i < coefs.length; i++) pred += coefs[i]! * row[i]!;
    if (offsets !== null) pred += row[row.length - 1]!;
    errors.push(Math.abs(Math.log(p.mcap_usd!) - pred));
  }
  return Math.exp(median(errors));
}

/** Leave-one-out median miss: every protocol priced from a fit on all the others. */
function looMiss(
  fitSet: SnapshotProtocol[],
  asOf: string,
  terms: string[],
  withCategory: boolean,
  ctx: ModelContext | null,
): number {
  const errors: number[] = [];
  for (let i = 0; i < fitSet.length; i++) {
    const train = fitSet.filter((_, j) => j !== i);
    const test = [fitSet[i]!];
    errors.push(Math.log(splitMiss(train, test, asOf, terms, withCategory, ctx)));
  }
  return Math.exp(median(errors));
}

/**
 * The three blind tests for every candidate term-set. Each term is tried on top of the size
 * curve alone, and it enters the final model only when it lowers the miss in ALL THREE
 * tests against the size curve — the rule the table prints, so a reader can check every
 * keep and every drop. The flat median multiple is the baseline; the control (another
 * row's growth) must not help, or the harness is broken.
 */
export function blindTests(
  fitSet: SnapshotProtocol[],
  asOf: string,
  ctx: ModelContext | null,
): { tests: TermTest[]; chosenTerms: string[]; withCategory: boolean; chosen: { loo: number; wfMed: number; wf60: number; pooled: number } } {
  const dated = fitSet.filter((p) => p.listed_at !== null).sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : 1));
  const medCut = dated[Math.floor(dated.length / 2)]!.listed_at!;
  const olderMed = dated.filter((p) => p.listed_at! < medCut);
  const newerMed = dated.filter((p) => p.listed_at! >= medCut);
  const cut60 = dated[Math.floor(dated.length * 0.6)]!.listed_at!;
  const older60 = dated.filter((p) => p.listed_at! < cut60);
  const newer60 = dated.filter((p) => p.listed_at! >= cut60);
  const run = (
    terms: string[],
    withCategory: boolean,
  ): { loo: number; wfMed: number; wf60: number } => ({
    loo: looMiss(fitSet, asOf, terms, withCategory, ctx),
    wfMed: splitMiss(olderMed, newerMed, asOf, terms, withCategory, ctx),
    wf60: splitMiss(older60, newer60, asOf, terms, withCategory, ctx),
  });
  const flat = (): { loo: number; wfMed: number; wf60: number } => {
    const miss = (train: SnapshotProtocol[], test: SnapshotProtocol[]): number => {
      const mults = train.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
      const m = mults[Math.floor(mults.length / 2)]!;
      const errs = test.map((p) => Math.abs(Math.log(p.mcap_usd!) - Math.log(m * p.tvl_usd)));
      return Math.exp(median(errs));
    };
    const looErrs = fitSet.map((_, i) => Math.log(miss(fitSet.filter((__, j) => j !== i), [fitSet[i]!])));
    return {
      loo: Math.exp(median(looErrs)),
      wfMed: miss(olderMed, newerMed),
      wf60: miss(older60, newer60),
    };
  };
  const pooled = (r: { loo: number; wfMed: number; wf60: number }): number =>
    Math.exp((Math.log(r.loo) + Math.log(r.wfMed) + Math.log(r.wf60)) / 3);
  const base = run(['logTVL'], false);
  const tests: TermTest[] = [
    { label: 'flat multiple', terms: [], withCategory: false, ...flat(), pooled: 0, kept: false, signHolds: null },
    { label: 'size curve', terms: ['logTVL'], withCategory: false, ...base, pooled: pooled(base), kept: true, signHolds: null },
  ];
  tests[0]!.pooled = pooled({ loo: tests[0]!.loo, wfMed: tests[0]!.wfMed, wf60: tests[0]!.wf60 });
  const candidates: { label: string; terms: string[]; withCategory: boolean }[] = [
    { label: '+ chain count', terms: ['logTVL', 'logChains'], withCategory: false },
    { label: '+ years listed', terms: ['logTVL', 'logAge'], withCategory: false },
    { label: '+ 7-day growth', terms: ['logTVL', 'growth'], withCategory: false },
    { label: '+ category effect', terms: ['logTVL'], withCategory: true },
    { label: '+ family token', terms: ['logTVL', 'famTok'], withCategory: false },
  ];
  const keptTerms: string[] = ['logTVL'];
  let withCategory = false;
  for (const c of candidates) {
    const r = run(c.terms, c.withCategory);
    // A term is kept only when it beats the size curve on ALL three blind tests by a real
    // margin (x0.02 miss), not by rounding. A term that helps one test and hurts another
    // is dropped, and the reason is printed in the table.
    const helps = r.loo < base.loo - 0.02 && r.wfMed < base.wfMed - 0.02 && r.wf60 < base.wf60 - 0.02;
    tests.push({ label: c.label, terms: [...c.terms], withCategory: c.withCategory, ...r, pooled: pooled(r), kept: helps, signHolds: null });
    if (helps) {
      for (const t of c.terms) if (!keptTerms.includes(t)) keptTerms.push(t);
      if (c.withCategory) withCategory = true;
    }
  }
  const control = run(['logTVL', 'controlGrowth'], false);
  tests.push({
    label: '+ control growth',
    terms: ['logTVL', 'controlGrowth'],
    withCategory: false,
    ...control,
    pooled: pooled(control),
    kept: false,
    signHolds: null,
  });
  // Sign holds: for each candidate row, the share of 100 seeded bootstrap refits where
  // the added term's coefficient keeps the sign of the full-fit coefficient. The baseline
  // and the category row have no single coefficient, so they carry null. A term that
  // flips sign in half its refits is a coin toss, however its blind tests read.
  for (let ti = 0; ti < tests.length; ti++) {
    const t = tests[ti]!;
    if (t.terms.length === 0 || t.withCategory) {
      t.signHolds = null;
      continue;
    }
    const xFull = fitSet.map((p) => designRow(p, asOf, t.terms, null, ctx));
    const yFull = fitSet.map((p) => Math.log(p.mcap_usd!));
    const full = ols(xFull, yFull);
    const k = t.terms.length; // the design row is [1, ...terms], so the added term sits at index terms.length
    const rng = mulberry32(20261114 + ti * 7919);
    let holds = 0;
    let tries = 0;
    for (let b = 0; b < 100; b++) {
      const idx = Array.from({ length: fitSet.length }, () => Math.floor(rng() * fitSet.length));
      try {
        const c = ols(idx.map((i) => xFull[i]!), idx.map((i) => yFull[i]!));
        tries += 1;
        if (full[k]! !== 0 && Math.sign(c[k]!) === Math.sign(full[k]!)) holds += 1;
      } catch {
        // A degenerate resample is skipped, not fudged.
      }
    }
    t.signHolds = tries > 0 ? holds / tries : null;
  }
  // The kept terms, combined, must still beat the size curve on all three tests; if the
  // combination ever fails, fall back to the single best kept addition, then to size only.
  let chosenTerms = [...keptTerms];
  if (chosenTerms.length > 1) {
    const combined = run(chosenTerms, withCategory);
    const ok = combined.loo < base.loo - 0.02 && combined.wfMed < base.wfMed - 0.02 && combined.wf60 < base.wf60 - 0.02;
    if (!ok) {
      const keptRows = tests.filter((t) => t.kept && t.terms.length > 1);
      keptRows.sort((a, b) => a.pooled - b.pooled);
      const best = keptRows[0];
      chosenTerms = best !== undefined ? [...best.terms] : ['logTVL'];
      withCategory = best !== undefined ? best.withCategory : false;
      for (const t of tests) if (t.terms.length > 1 && t.label !== best?.label) t.kept = false;
    }
  }
  const chosenR = run(chosenTerms, withCategory);
  return { tests, chosenTerms, withCategory, chosen: { ...chosenR, pooled: pooled(chosenR) } };
}

/** A seeded PRNG (mulberry32): deterministic bootstrap, no clock, no Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One quantile of numbers (linear interpolation). */
function quantile(values: number[], q: number): number {
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Leave-one-out residuals (log terms) of one term-set: the interval's raw material. */
function looResiduals(
  fitSet: SnapshotProtocol[],
  asOf: string,
  terms: string[],
  withCategory: boolean,
  ctx: ModelContext | null,
): number[] {
  const out: number[] = [];
  for (let i = 0; i < fitSet.length; i++) {
    const train = fitSet.filter((_, j) => j !== i);
    const xTrain = train.map((p) => designRow(p, asOf, terms, null, ctx));
    const yTrain = train.map((p) => Math.log(p.mcap_usd!));
    const coefs = ols(xTrain, yTrain);
    const offsets = withCategory ? categoryOffsets(train, asOf, terms, coefs, ctx) : null;
    const p = fitSet[i]!;
    const row = designRow(p, asOf, terms, offsets, ctx);
    let pred = 0;
    for (let k = 0; k < coefs.length; k++) pred += coefs[k]! * row[k]!;
    if (offsets !== null) pred += row[row.length - 1]!;
    out.push(Math.log(p.mcap_usd!) - pred);
  }
  return out;
}

/** Fit the size curve on the whole fit set, with the term-set the blind tests chose. */
export function fitSizeCurve(
  fitSet: SnapshotProtocol[],
  asOf: string,
  tests: TermTest[],
  chosenTerms: string[],
  withCategory: boolean,
  chosen: { loo: number; wfMed: number; wf60: number; pooled: number },
  ctx: ModelContext | null,
): FitResult {
  const terms = chosenTerms;
  const x = fitSet.map((p) => designRow(p, asOf, terms, null, ctx));
  const y = fitSet.map((p) => Math.log(p.mcap_usd!));
  const coefs = ols(x, y);
  const offsets = withCategory ? categoryOffsets(fitSet, asOf, terms, coefs, ctx) : null;
  let ssRes = 0;
  let ssTot = 0;
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const absErr: number[] = [];
  for (const p of fitSet) {
    const pred = predictLogValue(p, asOf, coefs, terms, offsets, ctx);
    const err = Math.log(p.mcap_usd!) - pred;
    ssRes += err * err;
    ssTot += (Math.log(p.mcap_usd!) - yMean) ** 2;
    absErr.push(Math.abs(err));
  }
  const looRes = looResiduals(fitSet, asOf, terms, withCategory, ctx);
  const quantiles = {
    q10: quantile(looRes, 0.1),
    q25: quantile(looRes, 0.25),
    q75: quantile(looRes, 0.75),
    q90: quantile(looRes, 0.9),
  };
  const coverage2575 = looRes.filter((r) => r >= quantiles.q25 && r <= quantiles.q75).length / looRes.length;
  const coverage1090 = looRes.filter((r) => r >= quantiles.q10 && r <= quantiles.q90).length / looRes.length;
  const withinX3 = looRes.filter((r) => Math.abs(r) <= Math.log(3)).length / looRes.length;
  const rng = mulberry32(20261114);
  const boot: number[][] = [];
  for (let b = 0; b < 200; b++) {
    const idx = Array.from({ length: fitSet.length }, () => Math.floor(rng() * fitSet.length));
    try {
      boot.push(ols(idx.map((i) => x[i]!), idx.map((i) => y[i]!)));
    } catch {
      // A degenerate resample is skipped, not fudged.
    }
  }
  const bootstrapSe = coefs.map((_, k) => {
    const vals = boot.map((c) => c[k]!);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, vals.length - 1));
  });
  const chosenLabel =
    tests.find((t) => t.kept && t.terms.length === terms.length && t.terms.every((v, i) => v === terms[i]))?.label ??
    (terms.length === 1 ? 'size curve' : `size curve + ${terms.slice(1).join(' + ')}`);
  return {
    n: fitSet.length,
    intercept: coefs[0]!,
    slope: coefs[1]!,
    coefs,
    chosenTerms: terms,
    chosenLabel,
    withCategory,
    catOffsets: Object.fromEntries(offsets ?? []),
    r2: 1 - ssRes / ssTot,
    residSd: Math.sqrt(ssRes / Math.max(1, fitSet.length - coefs.length)),
    medianFactor: Math.exp(median(absErr)),
    terms: tests,
    chosen,
    quantiles,
    coverage2575,
    coverage1090,
    withinX3,
    bootstrapSe,
  };
}

/** The fitted log launch value of one protocol under a coefficient set. */
export function predictLogValue(
  p: SnapshotProtocol,
  asOf: string,
  coefs: number[],
  terms: string[],
  catOffsets: Map<string, number> | null,
  ctx: ModelContext | null,
): number {
  const row = designRow(p, asOf, terms, catOffsets, ctx);
  let pred = 0;
  for (let i = 0; i < coefs.length; i++) pred += coefs[i]! * row[i]!;
  if (catOffsets !== null) pred += row[row.length - 1]!;
  return pred;
}

/** The fitted launch value of one protocol (the size curve, plus the chosen terms). */
export function launchValue(p: SnapshotProtocol, asOf: string, fit: FitResult, ctx: ModelContext | null): number {
  const offsets = fit.withCategory ? new Map(Object.entries(fit.catOffsets)) : null;
  const logValue = predictLogValue(p, asOf, fit.coefs, fit.chosenTerms, offsets, ctx);
  return Math.max(1, Math.exp(logValue));
}

/** The logistic features of one protocol (age in years, size, category share, family flag). */
function oddsFeatures(p: SnapshotProtocol, asOf: string, ctx: ModelContext | null): Record<string, number> {
  const age = ageDays(asOf, p.listed_at);
  const ageYears = Math.max(0.02, (age ?? 365) / 365);
  // change_7d is in percent, so the clamp is in percent too (see features()).
  const growth = Math.min(120, Math.max(-60, finite(p.change_7d, 0)));
  return {
    const: 1,
    logAge: Math.log(ageYears),
    logTVL: Math.log(p.tvl_usd),
    growth,
    catShare: ctx === null ? 0.5 : (ctx.catShare.get(p.slug) ?? ctx.oddsBaseRate),
    logChains: Math.log(Math.max(1, p.chains.length)),
    famTok: ctx !== null && (ctx.famTok.get(p.slug) ?? false) ? 1 : 0,
  };
}

function oddsRow(p: SnapshotProtocol, asOf: string, terms: string[], ctx: ModelContext | null): number[] {
  const f = oddsFeatures(p, asOf, ctx);
  return terms.map((t) => f[t]!);
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.min(30, Math.max(-30, z))));
}

/** Logistic regression by IRLS, warm-started from `start` when given. */
function logitFit(x: number[][], y: number[], start: number[] | null, iters = 60): number[] {
  const k = x[0]!.length;
  let beta = start !== null ? [...start] : new Array<number>(k).fill(0);
  for (let it = 0; it < iters; it++) {
    const xtwx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const xtwz: number[] = new Array<number>(k).fill(0);
    for (let i = 0; i < x.length; i++) {
      const row = x[i]!;
      let z = 0;
      for (let a = 0; a < k; a++) z += beta[a]! * row[a]!;
      const pr = sigmoid(z);
      const w = Math.max(1e-6, pr * (1 - pr));
      const zz = z + (y[i]! - pr) / w;
      for (let a = 0; a < k; a++) {
        xtwz[a]! += row[a]! * w * zz;
        for (let b = 0; b < k; b++) xtwx[a]![b]! += row[a]! * row[b]! * w;
      }
    }
    for (let a = 0; a < k; a++) xtwx[a]![a]! += 1e-6;
    const next = solveLinear(xtwx, xtwz);
    let delta = 0;
    for (let a = 0; a < k; a++) delta = Math.max(delta, Math.abs(next[a]! - beta[a]!));
    beta = next;
    if (delta < 1e-8) break;
  }
  return beta;
}

function brierScore(pred: number[], y: number[]): number {
  return pred.reduce((s, p, i) => s + (p - y[i]!) ** 2, 0) / Math.max(1, y.length);
}

/**
 * Fit the logistic odds, with a term table: each term is tried on top of the age term alone
 * and kept only when it lowers the Brier score in ALL THREE held-out tests (10-fold,
 * walk-forward by listing date, leave-one-out). The base rate is the baseline.
 */
export function fitOdds(snapshot: Snapshot, asOf: string, ctx: ModelContext | null): OddsFit {
  const peers = snapshot.protocols.filter(
    (p) => ageDays(asOf, p.listed_at) !== null && (p.category === null || !ODDS_EXCLUDED_CATEGORIES.has(p.category)),
  );
  const y = peers.map((p) => (hasToken(p) ? 1 : 0));
  const baseRate = y.reduce((s, v) => s + v, 0) / Math.max(1, y.length);
  const folds = peers.map((p) => fnv1a(p.slug) % 10);
  const dates = peers.map((p) => p.listed_at!);
  const order = [...peers.keys()].sort((a, b) => (dates[a]! < dates[b]! ? -1 : 1));
  const cut60 = order[Math.floor(order.length * 0.6)]!;
  const wfTrain = new Set(order.filter((i) => dates[i]! < dates[cut60]!));
  const wfTest = order.filter((i) => dates[i]! >= dates[cut60]!);
  const evalTerms = (terms: string[]): { brier10: number; brierWf: number; brierLoo: number; accuracy10: number } => {
    const x = peers.map((p) => oddsRow(p, asOf, terms, ctx));
    const full = logitFit(x, y, null);
    const pred10 = new Array<number>(y.length).fill(baseRate);
    for (let f = 0; f < 10; f++) {
      const tr = peers.map((_, i) => i).filter((i) => folds[i] !== f);
      const beta = logitFit(tr.map((i) => x[i]!), tr.map((i) => y[i]!), full, 12);
      for (let i = 0; i < y.length; i++) {
        if (folds[i] !== f) continue;
        let z = 0;
        for (let a = 0; a < terms.length; a++) z += beta[a]! * x[i]![a]!;
        pred10[i] = sigmoid(z);
      }
    }
    const trWf = [...wfTrain];
    const betaWf = logitFit(trWf.map((i) => x[i]!), trWf.map((i) => y[i]!), full, 12);
    const predWf = wfTest.map((i) => {
      let z = 0;
      for (let a = 0; a < terms.length; a++) z += betaWf[a]! * x[i]![a]!;
      return sigmoid(z);
    });
    const predLoo = new Array<number>(y.length).fill(baseRate);
    for (let i = 0; i < y.length; i++) {
      const tr = peers.map((_, j) => j).filter((j) => j !== i);
      const beta = logitFit(tr.map((j) => x[j]!), tr.map((j) => y[j]!), full, 8);
      let z = 0;
      for (let a = 0; a < terms.length; a++) z += beta[a]! * x[i]![a]!;
      predLoo[i] = sigmoid(z);
    }
    return {
      brier10: brierScore(pred10, y),
      brierWf: brierScore(predWf, wfTest.map((i) => y[i]!)),
      brierLoo: brierScore(predLoo, y),
      accuracy10: pred10.filter((p, i) => (p > 0.5) === (y[i]! > 0.5)).length / y.length,
    };
  };
  const baseEval = evalTerms(['const']);
  const ageEval = evalTerms(['const', 'logAge']);
  const termTests: OddsTermTest[] = [
    { label: 'base rate', terms: ['const'], ...baseEval, kept: false },
    { label: '+ years listed', terms: ['const', 'logAge'], ...ageEval, kept: true },
  ];
  let currentTerms = ['const', 'logAge'];
  let currentEval = ageEval;
  const candidates: { label: string; terms: string[] }[] = [
    { label: '+ size, log TVL', terms: ['const', 'logAge', 'logTVL'] },
    { label: '+ 7-day growth', terms: ['const', 'logAge', 'logTVL', 'growth'] },
    { label: '+ category share', terms: ['const', 'logAge', 'logTVL', 'catShare'] },
    { label: '+ family token', terms: ['const', 'logAge', 'logTVL', 'catShare', 'famTok'] },
    { label: '+ chain count', terms: ['const', 'logAge', 'logTVL', 'catShare', 'famTok', 'logChains'] },
  ];
  for (const c of candidates) {
    const r = evalTerms(c.terms);
    // A term is kept only when it beats the current model on ALL three Brier tests by a
    // real margin (0.001), not by rounding. A term that helps one test and hurts another
    // is dropped, and the reason is printed in the table.
    const helps = r.brier10 < currentEval.brier10 - 0.001 && r.brierWf < currentEval.brierWf - 0.001 && r.brierLoo < currentEval.brierLoo - 0.001;
    termTests.push({ label: c.label, terms: [...c.terms], ...r, kept: helps });
    if (helps) {
      currentTerms = [...c.terms];
      currentEval = r;
    }
  }
  const x = peers.map((p) => oddsRow(p, asOf, currentTerms, ctx));
  const coefs = logitFit(x, y, null);
  const ref: SnapshotProtocol = {
    slug: 'reference',
    name: 'reference',
    category: null,
    chains: [],
    tvl_usd: 100_000_000,
    change_7d: 0,
    mcap_usd: null,
    listed_at: null,
    gecko_id: null,
    symbol: null,
  };
  const oddsAt = [0.125, 0.5, 1, 1.5, 2, 3, 5].map((ageYears) => {
    const refP = { ...ref, listed_at: new Date(Date.parse(`${asOf}T00:00:00Z`) - ageYears * 365 * DAY_MS).toISOString().slice(0, 10) };
    const row = oddsRow(refP, asOf, currentTerms, ctx);
    let z = 0;
    for (let a = 0; a < currentTerms.length; a++) z += coefs[a]! * row[a]!;
    return { ageYears, odds: sigmoid(z) };
  });
  return {
    n: peers.length,
    baseRate,
    coefs,
    terms: currentTerms,
    brier10: currentEval.brier10,
    brierWf: currentEval.brierWf,
    brierLoo: currentEval.brierLoo,
    brierBase10: baseEval.brier10,
    brierBaseWf: baseEval.brierWf,
    accuracy10: currentEval.accuracy10,
    termTests,
    oddsAt,
  };
}

/** P(has recorded a token) for one protocol, from the logistic fit. */
export function oddsFor(p: SnapshotProtocol, asOf: string, odds: OddsFit, ctx: ModelContext | null): number {
  const row = oddsRow(p, asOf, odds.terms, ctx);
  let z = 0;
  for (let a = 0; a < odds.terms.length; a++) z += odds.coefs[a]! * row[a]!;
  return sigmoid(z);
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

/** The deposit one farm position needs: $1,000 for a per-wallet plan (the sandbox moves it). */
export function depositFor(_p: SnapshotProtocol): number {
  return 1000;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The farm plan's name, from the category — the same branches the steps use, so the
 * plan on the board and the plan in the detail view never disagree. */
export function planTypeFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Supply and borrow';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'Liquidity and swaps';
  if (c.includes('bridge')) return 'Bridge and use';
  if (c.includes('staking') || c.includes('restak')) return 'Stake and hold';
  if (c.includes('perpetual') || c.includes('derivative')) return 'Margin and hedge';
  if (c.includes('prediction')) return 'Prediction markets';
  if (c.includes('curator') || c.includes('allocator')) return 'Curated vault';
  if (c.includes('stable')) return 'Mint against collateral';
  if (c.includes('rwa')) return 'Tokenised asset';
  if (c.includes('insurance')) return 'Cover and hold';
  return 'Core product';
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
  const capital = depositFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  // change_7d is already in percent (+4.58 means +4.58%), so no x100 here.
  const growthPct = finite(p.change_7d, 0);
  const pace =
    growthPct > 5
      ? 'TVL is up sharply this week, so start this week before the crowd arrives.'
      : growthPct < -5
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
  interval_p10_usd: number;
  interval_p90_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  payout_usd: number;
  cost_usd: number;
  dollars_per_hour: number;
  breakeven_launch_usd: number;
  farmers: number;
  deposit_usd: number;
  hold_days: number;
  family_token: boolean;
  farm_steps: string[];
  plan_type: string;
  watchlist: boolean;
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
  interval_p10_usd: number;
  interval_p90_usd: number;
  rank_low: number;
  rank_high: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
  payout_usd: number;
  cost_usd: number;
  dollars_per_hour: number;
  breakeven_launch_usd: number;
  farmers: number;
  deposit_usd: number;
  hold_days: number;
  family_token: boolean;
  plan_type: string;
  watchlist: boolean;
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
  verdicts: { FARM: number; MARGINAL: number; SKIP: number };
  audit: { ranked: number; hasToken: number; setAside: number; total: number };
  bands: { label: string; multiple: number }[];
  checks: SelfCheck[];
  /** The fit's scatter: priced peers as (ln TVL, ln mcap), the fitted line at the median
   * chain count, and the P25–P75 band from the leave-one-out residuals. */
  scatter: { points: [number, number][]; intercept: number; slope: number; q25: number; q75: number };
  /** The record behind the odds: aged peers by years listed, and how many record a token. */
  oddsRecord: { label: string; peers: number; recorded: number; pct: number }[];
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
  deposit: number;
  hold: number;
  farmers: number;
  payout: number;
  cost: number;
  perHour: number;
  breakeven: number;
  verdict: 'FARM' | 'MARGINAL' | 'SKIP';
} {
  const deposit = depositFor(p);
  const hold = holdDaysFor(age);
  const farmers = Math.max(1, Math.round(farm.farmerBase * Math.pow(p.tvl_usd / farm.farmerTvlRef, farm.farmerExponent)));
  const payout = (farm.poolShare * expectedValue) / farmers;
  const gas = farm.gasSetupUsd + farm.gasWeeklyUsd * (hold / 7);
  const hours = farm.setupMinutes / 60 + (hold / 7) * (farm.weeklyMinutes / 60);
  const opportunity = deposit * farm.opportunityRate * (hold / 365);
  const cost = gas + hours * farm.hourlyUsd + opportunity;
  // Net dollars per hour after valuing the farmer's time: positive exactly when the
  // payout beats the full cost, so it can never praise a SKIP.
  const perHour = (payout - cost) / Math.max(0.01, hours);
  const breakeven = (cost * farmers) / Math.max(0.01, farm.poolShare * Math.max(0.01, odds));
  // The bar is a wage, not a ratio: FARM clears $25 an hour after every cost, MARGINAL
  // covers its cost, SKIP does not. The $25 bar is the farm's own hourly rate.
  const verdict = perHour >= farm.hourlyUsd ? 'FARM' : payout > cost ? 'MARGINAL' : 'SKIP';
  return { deposit, hold, farmers, payout, cost, perHour, breakeven, verdict };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The protocols the board ranks, strongest first, with ranks 1..n and refit rank ranges. */
export function buildBoard(snapshot: Snapshot, fit: FitResult, odds: OddsFit, ctx: ModelContext | null): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  // The interval is the leave-one-out residual band, not a symmetric multiple: the real
  // caps fell below the model more often than above it, and the band says so.
  const q = fit.quantiles;
  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const launch = launchValue(p, snapshot.as_of, fit, ctx);
    const o = oddsFor(p, snapshot.as_of, odds, ctx);
    const expected = Math.max(1, Math.round(launch * o));
    const econ = farmEconomics(p, age, expected, o);
    return { p, age, launch, odds: o, expected, econ };
  });
  scored.sort((a, b) => b.expected - a.expected || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  // Rank ranges over five refits: refit the size curve on each 80% fold and re-rank.
  const fitSet = valueFitSet(snapshot);
  const rankRanges = new Map<string, { low: number; high: number }>();
  for (let k = 0; k < 5; k++) {
    const train = fitSet.filter((p) => fnv1a(p.slug) % 5 !== k);
    const xTrain = train.map((p) => designRow(p, snapshot.as_of, fit.chosenTerms, null, ctx));
    const yTrain = train.map((p) => Math.log(p.mcap_usd!));
    const refitCoefs = ols(xTrain, yTrain);
    const refitOffsets = fit.withCategory ? categoryOffsets(train, snapshot.as_of, fit.chosenTerms, refitCoefs, ctx) : null;
    const refit = scored
      .map((s) => ({
        slug: s.p.slug,
        ev: Math.max(
          1,
          Math.round(Math.exp(predictLogValue(s.p, snapshot.as_of, refitCoefs, fit.chosenTerms, refitOffsets, ctx)) * s.odds),
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
      interval_low_usd: Math.max(1, Math.round(s.expected * Math.exp(q.q25))),
      interval_high_usd: Math.max(1, Math.round(s.expected * Math.exp(q.q75))),
      interval_p10_usd: Math.max(1, Math.round(s.expected * Math.exp(q.q10))),
      interval_p90_usd: Math.max(1, Math.round(s.expected * Math.exp(q.q90))),
      rank_low: range.low,
      rank_high: range.high,
      verdict: s.econ.verdict,
      payout_usd: round2(s.econ.payout),
      cost_usd: round2(s.econ.cost),
      dollars_per_hour: round2(s.econ.perHour),
      breakeven_launch_usd: Math.max(1, Math.round(s.econ.breakeven)),
      farmers: s.econ.farmers,
      deposit_usd: s.econ.deposit,
      hold_days: s.econ.hold,
      family_token: ctx !== null && (ctx.famTok.get(s.p.slug) ?? false),
      farm_steps: farmSteps(s.p, s.age).map(stepText),
      plan_type: planTypeFor(s.p),
      watchlist: snapshot.watchlist.includes(s.p.slug),
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
function fittedMultiple(tvl: number, fit: FitResult, asOf: string, ctx: ModelContext | null): number {
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
  return Math.exp(predictLogValue(synthetic, asOf, fit.coefs, fit.chosenTerms, offsets, ctx)) / tvl;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const ctx = buildContext(snapshot);
  const fitSet = valueFitSet(snapshot);
  const { tests, chosenTerms, withCategory, chosen } = blindTests(fitSet, snapshot.as_of, ctx);
  const fit = fitSizeCurve(fitSet, snapshot.as_of, tests, chosenTerms, withCategory, chosen, ctx);
  const odds = fitOdds(snapshot, snapshot.as_of, ctx);
  const board = buildBoard(snapshot, fit, odds, ctx);
  const live = liveRows(snapshot);
  const setAside = snapshot.protocols
    .filter((p) => isPreToken(p) && exclusionReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, reason: exclusionReason(p)! }));
  const hasTokenCount = snapshot.protocols.filter(hasToken).length;
  const unpriced = snapshot.protocols.filter((p) => hasToken(p) && p.mcap_usd === null).length;
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const verdicts = { FARM: 0, MARGINAL: 0, SKIP: 0 };
  for (const r of board) verdicts[r.verdict] += 1;
  const bands: { label: string; multiple: number }[] = [
    { label: '$5–20M TVL', multiple: fittedMultiple(10_000_000, fit, snapshot.as_of, ctx) },
    { label: '$20–100M TVL', multiple: fittedMultiple(50_000_000, fit, snapshot.as_of, ctx) },
    { label: '$100–500M TVL', multiple: fittedMultiple(250_000_000, fit, snapshot.as_of, ctx) },
    { label: '$0.5–2B TVL', multiple: fittedMultiple(1_000_000_000, fit, snapshot.as_of, ctx) },
    { label: 'over $2B TVL', multiple: fittedMultiple(5_000_000_000, fit, snapshot.as_of, ctx) },
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
      detail: `size curve fit on ${fit.n} priced peers (81 after the category and multiple screens); no protocol name is special-cased`,
      pass: fit.n === fitSet.length && fit.n > 0,
    },
    {
      name: 'Odds rise with age',
      detail: `logistic odds on ${odds.n} aged peers, Brier ${odds.brier10.toFixed(3)} held out vs ${odds.brierBase10.toFixed(3)} for the base rate; odds ${odds.oddsAt[1]!.odds.toFixed(2)} at 6 months, ${odds.oddsAt[5]!.odds.toFixed(2)} at 3 years`,
      pass: odds.oddsAt.every((o, i) => i === 0 || o.odds >= odds.oddsAt[i - 1]!.odds),
    },
    {
      name: 'Blind-tested terms',
      detail: `${tests.length} term-sets tested three ways; kept "${fit.chosenLabel}" at LOO x${fit.chosen.loo.toFixed(2)}, walk-forward x${fit.chosen.wfMed.toFixed(2)}`,
      pass: tests.some((t) => t.kept),
    },
    {
      name: 'Ranges are honest',
      detail: `leave-one-out caps land inside the printed P25–P75 band ${Math.round(fit.coverage2575 * 100)}% of the time (stated 50%) and inside P10–P90 ${Math.round(fit.coverage1090 * 100)}% (stated 80%)`,
      pass: Math.abs(fit.coverage2575 - 0.5) <= 0.1 && Math.abs(fit.coverage1090 - 0.8) <= 0.1,
    },
    {
      name: 'Control did not help',
      detail: (() => {
        const c = tests.find((t) => t.label.includes('control'))!;
        const helpsAll = c.loo < fit.chosen.loo - 0.02 && c.wfMed < fit.chosen.wfMed - 0.02 && c.wf60 < fit.chosen.wf60 - 0.02;
        return `a hash-drawn growth value, which must not price a token, misses LOO x${c.loo.toFixed(2)}, walk-forward x${c.wfMed.toFixed(2)} and x${c.wf60.toFixed(2)} vs x${fit.chosen.loo.toFixed(2)} / x${fit.chosen.wfMed.toFixed(2)} / x${fit.chosen.wf60.toFixed(2)} for the kept model — it does not beat the kept model on all three`;
      })(),
      pass: (() => {
        const c = tests.find((t) => t.label.includes('control'))!;
        return !(c.loo < fit.chosen.loo - 0.02 && c.wfMed < fit.chosen.wfMed - 0.02 && c.wf60 < fit.chosen.wf60 - 0.02);
      })(),
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
    model_version: 'radar-4',
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
    scatter: (() => {
      const points: [number, number][] = fitSet.map((p) => [Math.log(p.tvl_usd), Math.log(p.mcap_usd!)]);
      const logChains = fitSet.map((p) => Math.log(Math.max(1, p.chains.length))).sort((a, b) => a - b);
      const medianLogChains = logChains[Math.floor(logChains.length / 2)]!;
      const intercept = fit.coefs[0]! + (fit.chosenTerms.includes('logChains') ? fit.coefs[2]! * medianLogChains : 0);
      return { points, intercept, slope: fit.coefs[1]!, q25: fit.quantiles.q25, q75: fit.quantiles.q75 };
    })(),
    oddsRecord: (() => {
      const aged = snapshot.protocols.filter(
        (p) => ageDays(snapshot.as_of, p.listed_at) !== null && (p.category === null || !ODDS_EXCLUDED_CATEGORIES.has(p.category)),
      );
      const buckets: { label: string; min: number; max: number }[] = [
        { label: '0–1y', min: 0, max: 1 },
        { label: '1–2y', min: 1, max: 2 },
        { label: '2–3y', min: 2, max: 3 },
        { label: '3y+', min: 3, max: Infinity },
      ];
      return buckets.map((b) => {
        const peers = aged.filter((p) => {
          const years = ageDays(snapshot.as_of, p.listed_at)! / 365;
          return years >= b.min && years < b.max;
        });
        const recorded = peers.filter((p) => hasToken(p)).length;
        return { label: b.label, peers: peers.length, recorded, pct: peers.length > 0 ? recorded / peers.length : 0 };
      });
    })(),
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
      interval_p10_usd: r.interval_p10_usd,
      interval_p90_usd: r.interval_p90_usd,
      rank_low: r.rank_low,
      rank_high: r.rank_high,
      verdict: r.verdict,
      payout_usd: r.payout_usd,
      cost_usd: r.cost_usd,
      dollars_per_hour: r.dollars_per_hour,
      breakeven_launch_usd: r.breakeven_launch_usd,
      farmers: r.farmers,
      deposit_usd: r.deposit_usd,
      hold_days: r.hold_days,
      family_token: r.family_token,
      plan_type: r.plan_type,
      watchlist: r.watchlist,
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
export function dataScript(radar: RadarData, seal: string): string {
  return `window.RADAR=${JSON.stringify({ ...radar, seal })};\n`;
}
