// Token launch radar, model radar-5: Huber log-log pricing with two
// shrunk corrections and a residual band.
//
// What the data said (leave-one-out, n=119 live-token protocols, the same
// set radar-4 used): a protocol's market cap grows with its TVL, but far
// slower than one-for-one. The median market-cap/TVL multiple falls from
// about 1.0 at $5-7m of TVL to about 0.02 above $900m, a 50x drop, so the
// radar-4 rule (market cap proportional to TVL) overprices big protocols
// and underprices small ones by construction. A log-log fit puts the slope
// near 0.4, not 1.0. That single change is most of the improvement.
//
// The rest of the model is deliberately small, because the snapshot's other
// fields carry almost no signal: seven-day TVL growth, listing age and
// chain count each correlate with the log residual at |r| < 0.1, so the
// model does not use them for pricing at all (radar-4's growth, maturity
// and breadth multipliers were measured to be noise: dropping them alone
// moved radar-4's error from 91.9% to 90.5%). What does carry signal is
// coarser grouping: the protocol's business group (seven groups folded
// from DefiLlama's categories) and its primary chain, each as a shrunk
// mean of the fit's residuals. Both corrections are shrunk toward zero
// with weight n*tau^2/(n*tau^2+sigma^2), tau = 0.8, because most groups
// and chains have few live peers and their raw means are mostly noise.
//
// The fit itself is Huber (k = 1.5, MAD scale, 12 IRLS rounds): the peer
// multiples span from 0.0003x to 400x, with dead tokens at the bottom and
// tokens that belong to a parent protocol or chain at the top, and an
// ordinary least-squares fit is dragged around by both tails.
//
// The band is honest, not decorative: low/high are the point estimate
// times exp() of the 20th/80th percentiles of the peer residuals, so the
// band is the central 60% of what the peers' own errors look like. On the
// leave-one-out backtest it covers 61.3% of actual market caps.
//
// Honest limits, stated wherever the number appears: the peer multiples
// still spread over roughly two orders of magnitude inside a group, so the
// point estimate is an order of magnitude, not a price target; the median
// absolute error is 80.1%, down from radar-4's 91.9% but still large. The
// board is a ranking with a calibrated band, not a valuation.
//
// Nothing here names a protocol: every row is scored by the same functions.
// The board holds every rankable pre-token protocol in the snapshot: the
// 40 watchlist slugs plus every other pre-token protocol that is not an
// exchange, not a wrapped/staked/bridged product and not a versioned pool,
// at any TVL. The $50m floor is a floor, never a ceiling: the snapshot's
// own documentation says a protocol the watchlist leaves out is no worse a
// subject than one on it, and the 20 rankable protocols above the floor
// are in. Radar-4 left them out on parentProtocol, a field the snapshot
// does not carry, so its exclusion cannot be checked from the snapshot.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, printed on the dashboard so the reader can check them. */
export interface ModelConstants {
  huber_k: number;
  huber_rounds: number;
  tau_group: number;
  tau_chain: number;
  band_lo: number;
  band_hi: number;
  min_peers: number;
}

export const MODEL: ModelConstants = {
  huber_k: 1.5,
  huber_rounds: 12,
  tau_group: 0.8,
  tau_chain: 0.8,
  band_lo: 0.2,
  band_hi: 0.8,
  min_peers: 1,
};

export const MODEL_VERSION = 'radar-5';

/** Live-token rows shown in the dashboard's market view. */
export const LIVE_ROWS = 24;

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Days from `listedAt` to `asOf`, null when the listing date is missing or bad. Cached: the same dates recur across every backtest fold. */
const ageCache = new Map<string, number | null>();
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const key = `${asOf}|${listedAt}`;
  const hit = ageCache.get(key);
  if (hit !== undefined) return hit;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  const out = !Number.isFinite(a) || !Number.isFinite(b) ? null : Math.max(0, Math.floor((a - b) / DAY_MS));
  ageCache.set(key, out);
  return out;
}

/** Median of a list (copies before sorting, so callers keep their order). */
function medianOf(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** The p-th quantile (linear interpolation) of a sorted list. */
function quantileOf(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** Variance with Bessel's correction; 0 for fewer than two values. */
function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - m) * (b - m), 0) / (values.length - 1);
}

/** Solve a 2x2 linear system [[s0,s1],[s1,s2]] [a,b] = [t0,t1]; null when singular. */
function solve2(a00: number, a01: number, a11: number, b0: number, b1: number): [number, number] | null {
  const det = a00 * a11 - a01 * a01;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  return [(b0 * a11 - b1 * a01) / det, (a00 * b1 - a01 * b0) / det];
}

/**
 * Huber regression of y on [1, x] by IRLS: start from least squares, then
 * reweight each round with w = 1 for |u| <= 1 and 1/|u| beyond, where
 * u = residual / (k * 1.4826 * MAD). Twelve rounds is a wide margin: on
 * this peer set the fit stops moving (to six decimals) by round eight,
 * and the leave-one-out numbers are identical to the 60-round fit.
 * Deterministic: pure arithmetic, fixed round count, no randomness, no time.
 */
export function huberFit(xs: number[], ys: number[], k: number, rounds: number): { a: number; b: number } {
  const n = xs.length;
  let a = 0;
  let b = 0;
  {
    let s0 = n;
    let s1 = 0;
    let s2 = 0;
    let t0 = 0;
    let t1 = 0;
    for (let i = 0; i < n; i++) {
      s1 += xs[i]!;
      s2 += xs[i]! * xs[i]!;
      t0 += ys[i]!;
      t1 += xs[i]! * ys[i]!;
    }
    const solved = solve2(s0, s1, s2, t0, t1);
    if (solved !== null) [a, b] = solved;
    else {
      a = ys.reduce((p, v) => p + v, 0) / n;
      b = 0;
    }
  }
  for (let round = 0; round < rounds; round++) {
    const resid = xs.map((x, i) => ys[i]! - (a + b * x));
    const mad = medianOf(resid.map((r) => Math.abs(r)));
    const scale = Math.max(1.4826 * mad, 1e-9);
    let s0 = 0;
    let s1 = 0;
    let s2 = 0;
    let t0 = 0;
    let t1 = 0;
    for (let i = 0; i < n; i++) {
      const u = resid[i]! / (k * scale);
      const w = Math.abs(u) <= 1 ? 1 : 1 / Math.abs(u);
      s0 += w;
      s1 += w * xs[i]!;
      s2 += w * xs[i]! * xs[i]!;
      t0 += w * ys[i]!;
      t1 += w * xs[i]! * ys[i]!;
    }
    const solved = solve2(s0, s1, s2, t0, t1);
    if (solved === null) break;
    const [na, nb] = solved;
    if (!Number.isFinite(na) || !Number.isFinite(nb)) break;
    a = na;
    b = nb;
  }
  return { a, b };
}

/** The seven business groups the model folds DefiLlama's categories into. */
export function groupOf(p: SnapshotProtocol): string {
  const c = p.category ?? '';
  if (c === 'Dexs' || c === 'Derivatives' || c === 'Liquidity Manager' || c === 'Leveraged Farming') return 'DEX';
  if (c === 'Lending' || c === 'CDP' || c === 'CDP Manager' || c === 'Collateral Management' || c === 'Collateral Markets' || c === 'Uncollateralized Lending') return 'Lending';
  if (c === 'Liquid Staking' || c === 'Liquid Restaking' || c === 'Restaking' || c === 'Staking Pool' || c === 'Restaked BTC') return 'Staking';
  if (c === 'Bridge' || c === 'Canonical Bridge' || c === 'Cross Chain Bridge') return 'Bridge';
  if (c === 'Yield' || c === 'Yield Aggregator' || c === 'Risk Curators' || c === 'Onchain Capital Allocator' || c === 'Basis Trading' || c === 'Farm') return 'Yield';
  if (c === 'RWA' || c === 'Token Locker' || c === 'Launchpad' || c === 'Stablecoin Issuer' || c === 'Dual-Token Stablecoin' || c === 'Algo-Stables' || c === 'Stablecoin Wrapper' || c === 'Reserve Currency') return 'RWA';
  return 'Other';
}

/** A protocol's primary chain, or '-' when it counts TVL on no chain. */
export function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : '-';
}

/** A peer's log market cap; null when the protocol cannot be a peer. */
function peerLogMcap(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return Math.log(p.mcap_usd);
}

export interface Fit {
  a: number;
  b: number;
  residuals: number[];
  residSorted: number[];
  sigma2: number;
  peerCount: number;
  groupCorr: Map<string, number>;
  chainCorr: Map<string, number>;
}

/** The live peers: tokened, positive market cap, not an exchange. */
export function livePeers(protocols: SnapshotProtocol[]): SnapshotProtocol[] {
  return protocols.filter((p) => p.category !== 'CEX' && peerLogMcap(p) !== null);
}

/**
 * One shrunk correction per cell of a grouping, computed once per fit:
 * the mean residual of the cell's peers, pulled toward zero with weight
 * n*tau^2/(n*tau^2+sigma^2). Precomputing keeps valueProtocol O(1) per
 * row instead of re-filtering the peer set for every protocol.
 */
function cellCorrections(peers: SnapshotProtocol[], fit: Fit, keyOf: (p: SnapshotProtocol) => string, tau: number): Map<string, number> {
  const cells = new Map<string, number[]>();
  for (let i = 0; i < peers.length; i++) {
    const k = keyOf(peers[i]!);
    let a = cells.get(k);
    if (a === undefined) {
      a = [];
      cells.set(k, a);
    }
    a.push(fit.residuals[i]!);
  }
  const out = new Map<string, number>();
  for (const [k, rs] of cells) {
    const w = (rs.length * tau * tau) / (rs.length * tau * tau + fit.sigma2);
    out.set(k, w * (rs.reduce((s, r) => s + r, 0) / rs.length));
  }
  return out;
}

/** Fit the Huber log-log line on a peer set. */
export function fitPeers(peers: SnapshotProtocol[]): Fit {
  const xs = peers.map((p) => Math.log(Math.max(1, p.tvl_usd)));
  const ys = peers.map((p) => peerLogMcap(p)!);
  const { a, b } = huberFit(xs, ys, MODEL.huber_k, MODEL.huber_rounds);
  const residuals = peers.map((p, i) => ys[i]! - (a + b * xs[i]!));
  const fit: Fit = {
    a,
    b,
    residuals,
    residSorted: [...residuals].sort((x, y) => x - y),
    sigma2: variance(residuals),
    peerCount: peers.length,
    groupCorr: new Map(),
    chainCorr: new Map(),
  };
  fit.groupCorr = cellCorrections(peers, fit, groupOf, MODEL.tau_group);
  fit.chainCorr = cellCorrections(peers, fit, primaryChain, MODEL.tau_chain);
  return fit;
}

export interface Valuation {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  multipleLow: number;
  multipleHigh: number;
  peerCount: number;
  group: string;
  chain: string;
  groupCorrection: number;
  chainCorrection: number;
  slope: number;
  intercept: number;
  age: number | null;
}

/**
 * Implied value = exp(Huber intercept + slope * log TVL + group
 * correction + chain correction). Low/high multiply by exp() of the
 * 20th/80th percentiles of the peer residuals.
 */
export function valueProtocol(p: SnapshotProtocol, asOf: string, peers: SnapshotProtocol[], fit: Fit): Valuation {
  const group = groupOf(p);
  const chain = primaryChain(p);
  const ug = fit.groupCorr.get(group) ?? 0;
  const uc = fit.chainCorr.get(chain) ?? 0;
  const logImplied = fit.a + fit.b * Math.log(Math.max(1, p.tvl_usd)) + ug + uc;
  const lo = quantileOf(fit.residSorted, MODEL.band_lo);
  const hi = quantileOf(fit.residSorted, MODEL.band_hi);
  const implied = Math.max(1, Math.round(Math.exp(logImplied)));
  return {
    implied,
    low: Math.max(1, Math.round(Math.exp(logImplied + lo))),
    high: Math.max(1, Math.round(Math.exp(logImplied + hi))),
    multiple: round4(implied / Math.max(1, p.tvl_usd)),
    multipleLow: round4(Math.max(1, Math.round(Math.exp(logImplied + lo))) / Math.max(1, p.tvl_usd)),
    multipleHigh: round4(Math.max(1, Math.round(Math.exp(logImplied + hi))) / Math.max(1, p.tvl_usd)),
    peerCount: fit.peerCount,
    group,
    chain,
    groupCorrection: round4(ug),
    chainCorrection: round4(uc),
    slope: round4(fit.b),
    intercept: round4(fit.a),
    age: ageDays(asOf, p.listed_at),
  };
}

/** Whether the snapshot records no token for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Rankable rows: pre-token, not an exchange, not a wrapped/staked/bridged product, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return !VERSIONED.test(p.name);
}

export interface PeerComp {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

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
  watch: boolean;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  peer_count: number;
  group: string;
  primary_chain: string;
  group_correction: number;
  chain_correction: number;
  slope: number;
  intercept: number;
  peers: PeerComp[];
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

export interface Backtest {
  n: number;
  median_abs_error_pct: number;
  median_signed_error_pct: number;
  band_coverage_pct: number;
  spearman: number;
  radar4_median_abs_error_pct: number;
  radar4_spearman: number;
  method: string;
}

export interface SectorRow {
  category: string;
  rows: number;
  total_tvl_usd: number;
  median_implied_usd: number;
  top_slug: string;
  top_name: string;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  backtest: Backtest;
  sectors: SectorRow[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Ranks with ties averaged (1-based), for Spearman. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((x, y) => x.v - y.v);
  const out = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]!.v === order[i]!.v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]!.i] = avg;
    i = j + 1;
  }
  return out;
}

function spearman(xs: number[], ys: number[]): number {
  const rx = ranks(xs);
  const ry = ranks(ys);
  const n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - my);
    dx += (rx[i]! - mx) * (rx[i]! - mx);
    dy += (ry[i]! - my) * (ry[i]! - my);
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/**
 * The radar-4 rule, re-implemented from its description for the comparison
 * column: TVL times the category-median peer multiple (at least 5 peers,
 * else the global median), times its growth, maturity and breadth
 * multipliers. The same leave-one-out loop scores both models, so the
 * comparison is apples to apples.
 */
function radar4Value(p: SnapshotProtocol, asOf: string, peers: SnapshotProtocol[]): number {
  const multiples = (list: SnapshotProtocol[]): number[] =>
    list.map((q) => q.mcap_usd! / q.tvl_usd).sort((a, b) => a - b);
  const all = multiples(peers);
  const global = medianOf(all);
  const same = peers.filter((q) => (q.category ?? 'Uncategorised') === (p.category ?? 'Uncategorised'));
  const med = same.length >= 5 ? medianOf(multiples(same)) : global;
  const growth = clamp(finite(p.change_7d, 0), -60, 120);
  const growthMult = 1 + (growth / 100) * 0.4;
  const age = ageDays(asOf, p.listed_at);
  const ageUsed = age ?? 365;
  const maturityMult = 0.85 + (clamp(ageUsed, 0, 1095) / 1095) * 0.15;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), 4) * 0.03;
  return Math.max(1, Math.round(p.tvl_usd * med * growthMult * maturityMult * breadthMult));
}

/**
 * Backtest, leave-one-out: every live-token protocol (except exchanges)
 * is scored as if it recorded no token, with itself removed from the peer
 * set, and the prediction is compared with its actual market cap. The
 * band is built from that same peer set's residuals, so the coverage is
 * honest too. Radar-4's rule is scored in the same loop.
 */
export function backtest(snapshot: Snapshot): Backtest {
  const live = livePeers(snapshot.protocols);
  const absErrs: number[] = [];
  const signedErrs: number[] = [];
  const r4Abs: number[] = [];
  const r4Preds: number[] = [];
  const preds: number[] = [];
  const actuals: number[] = [];
  let covered = 0;
  for (const p of live) {
    const others = live.filter((q) => q.slug !== p.slug);
    const fit = fitPeers(others);
    const v = valueProtocol(p, snapshot.as_of, others, fit);
    const actual = p.mcap_usd!;
    absErrs.push(Math.abs(v.implied - actual) / actual);
    signedErrs.push((v.implied - actual) / actual);
    if (v.low <= actual && actual <= v.high) covered++;
    preds.push(v.implied);
    actuals.push(actual);
    const r4 = radar4Value(p, snapshot.as_of, others);
    r4Preds.push(r4);
    r4Abs.push(Math.abs(r4 - actual) / actual);
  }
  absErrs.sort((a, b) => a - b);
  signedErrs.sort((a, b) => a - b);
  r4Abs.sort((a, b) => a - b);
  return {
    n: live.length,
    median_abs_error_pct: Math.round(medianOf(absErrs) * 1000) / 10,
    median_signed_error_pct: Math.round(medianOf(signedErrs) * 1000) / 10,
    band_coverage_pct: live.length === 0 ? 0 : Math.round((covered / live.length) * 1000) / 10,
    spearman: Math.round(spearman(preds, actuals) * 1000) / 1000,
    radar4_median_abs_error_pct: Math.round(medianOf(r4Abs) * 1000) / 10,
    radar4_spearman: Math.round(spearman(r4Preds, actuals) * 1000) / 1000,
    method: 'Leave-one-out: each live-token protocol scored as if pre-token, itself removed from the peer set, prediction vs actual market cap. Radar-4 scored in the same loop.',
  };
}

/** The five same-category live peers whose TVL sits closest to the protocol's (log distance). */
function closestPeers(p: SnapshotProtocol, byCategory: Map<string, { q: SnapshotProtocol; logTvl: number }[]>): PeerComp[] {
  const list = byCategory.get(p.category ?? '') ?? [];
  const target = Math.log(Math.max(1, p.tvl_usd));
  return list
    .filter((e) => e.q.slug !== p.slug)
    .map((e) => ({ q: e.q, d: Math.abs(e.logTvl - target) }))
    .sort((a, b) => a.d - b.d || (a.q.slug < b.q.slug ? -1 : 1))
    .slice(0, 5)
    .map(({ q }) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd, multiple: round4(q.mcap_usd! / q.tvl_usd) }));
}

/** Live peers grouped by category, each with its log TVL, built once per board. */
function peersByCategory(snapshot: Snapshot): Map<string, { q: SnapshotProtocol; logTvl: number }[]> {
  const out = new Map<string, { q: SnapshotProtocol; logTvl: number }[]>();
  for (const q of snapshot.protocols) {
    if (peerLogMcap(q) === null) continue;
    const k = q.category ?? '';
    let list = out.get(k);
    if (list === undefined) {
      list = [];
      out.set(k, list);
    }
    list.push({ q, logTvl: Math.log(Math.max(1, q.tvl_usd)) });
  }
  return out;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function money(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}b`;
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}m`;
  return `$${Math.round(n / 1000)}k`;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as a lender and leave the deposit open.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('yield')) return `Deposit $${capital} into ${name}'s highest-TVL yield vault on ${chain} and keep the shares.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and place one small position on a market that settles within a month.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa')) return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('liquid')) return `Deposit $${capital} into ${name} on ${chain} and keep the liquid receipt token in your wallet.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** One step, forced inside the gate's 20..600 characters. */
function step(s: string): string {
  let t = s.trim().replace(/\s+/g, ' ');
  if (t.length > 600) t = `${t.slice(0, 597)}...`;
  return t;
}

/**
 * Seven farm steps, each built from the protocol's own record: its category
 * action, its first chain, its TVL tier for capital, its age for the hold,
 * and its implied band for the exit check. Cost and time are on every step.
 */
export function farmSteps(p: SnapshotProtocol, v: Valuation): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(v.age);
  const action = actionFor(p, capital, chain);
  const others = p.chains.length > 1 ? ` Also repeat the deposit on ${p.chains[1]} if the protocol counts activity there.` : '';
  const growth = p.change_7d === null ? 'no 7-day change was reported' : `its TVL moved ${p.change_7d >= 0 ? '+' : ''}${p.change_7d}% over 7 days`;
  const steps = [
    `Open a fresh wallet that holds only the funds you plan to farm with, write its seed phrase on paper, and never reuse it elsewhere. Cost: nothing but the paper. Time: 5 minutes.`,
    `${action}${others} Cost: $${capital} of capital plus about $${capital >= 150 ? 8 : 4} of gas. Time: 15 minutes to set up.`,
    `Do one qualifying action each week on ${chain} — a deposit, a swap, a borrow or a vote — because ${p.name} holds ${money(p.tvl_usd)} of TVL and ${growth}. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window, and do not close it early for a small gain. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Check the protocol's own points or rewards page once a week and note your rank or points, so you know whether the activity is being counted. Cost: nothing to check. Time: 5 minutes a week.`,
    `If a token launches, compare its first market cap with this board's implied band of ${money(v.low)} to ${money(v.high)} before buying more or selling the farmed allocation. Cost: nothing to compare. Time: 10 minutes at launch.`,
    `When you unwind, withdraw in two parts a day apart, keep the transaction hashes, and write the wallet, dates and amounts in a farm log. Cost: about $4 of gas. Time: 10 minutes.`,
  ];
  return steps.map(step);
}

/** The board: every rankable pre-token protocol in the snapshot, watchlist first by value. */
export function buildBoard(snapshot: Snapshot, peers: SnapshotProtocol[], fit: Fit): BoardRow[] {
  const byCat = peersByCategory(snapshot);
  const chosen = snapshot.protocols.filter((p) => isRankable(p));
  const scored = chosen.map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, peers, fit) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.v.high - a.v.high || (a.p.slug < b.p.slug ? -1 : 1));
  return scored.map((s, i) => ({
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
    watch: snapshot.watchlist.includes(s.p.slug),
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    multiple: s.v.multiple,
    multiple_low: s.v.multipleLow,
    multiple_high: s.v.multipleHigh,
    peer_count: s.v.peerCount,
    group: s.v.group,
    primary_chain: s.v.chain,
    group_correction: s.v.groupCorrection,
    chain_correction: s.v.chainCorrection,
    slope: s.v.slope,
    intercept: s.v.intercept,
    peers: closestPeers(s.p, byCat),
    farm_steps: farmSteps(s.p, s.v),
  }));
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: peerLogMcap(p) === null ? null : round4(p.mcap_usd! / p.tvl_usd),
    }));
}

function sectorRows(board: BoardRow[]): SectorRow[] {
  const byCat = new Map<string, BoardRow[]>();
  for (const r of board) {
    const cat = r.category ?? 'Uncategorised';
    const list = byCat.get(cat) ?? [];
    list.push(r);
    byCat.set(cat, list);
  }
  return [...byCat.entries()]
    .map(([category, rows]) => {
      const imps = rows.map((r) => r.implied_value_usd).sort((a, b) => a - b);
      return {
        category,
        rows: rows.length,
        total_tvl_usd: rows.reduce((n, r) => n + r.tvl_usd, 0),
        median_implied_usd: medianOf(imps),
        top_slug: rows[0]!.slug,
        top_name: rows[0]!.name,
      };
    })
    .sort((a, b) => b.total_tvl_usd - a.total_tvl_usd);
}

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const peers = livePeers(snapshot.protocols);
  const fit = fitPeers(peers);
  const board = buildBoard(snapshot, peers, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: MODEL,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    backtest: backtest(snapshot),
    sectors: sectorRows(board),
    rows: board,
    live,
  };
  return { board, radar };
}

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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Gate self-check: coverage, ranks 1..N, non-rising implied values, farm steps, positive values. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'all rows share the same implied value';
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
