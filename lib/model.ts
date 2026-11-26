// Token launch radar, model radar-4: calibrated peer multiples.
//
// Idea: a pre-token protocol is worth what the market already pays for the
// same kind of protocol. For every category we take the live-token protocols
// in this very snapshot, form each peer's market-cap / TVL multiple, and use
// the category median as the price of one TVL dollar. A protocol's implied
// fully-diluted value is then its own TVL times that median, moved by three
// readings of its own record: seven-day TVL growth, how long it has run
// without a token, and how many chains it runs on. The interquartile range
// of the same peers gives the low/high band, so the width of the band says
// how much the market itself disagrees.
//
// Honest limits, stated wherever the number appears: market cap is used as
// the peer value because the snapshot carries no fully-diluted value, so the
// "implied FDV" is really an implied market cap at launch; and the peer
// multiples spread roughly 25x from first to third quartile, so the band is
// wide and the point estimate is an order of magnitude, not a price target.
// The backtest below measures exactly that spread on the live protocols and
// its numbers are printed on the dashboard, good or bad.
//
// Nothing here names a protocol: every row is scored by the same functions.

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
  min_peers: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_step: number;
  breadth_cap_chains: number;
}

export const MODEL: ModelConstants = {
  min_peers: 5,
  growth_weight: 0.4,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.85,
  maturity_range: 0.15,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap_chains: 4,
};

export const MODEL_VERSION = 'radar-4';

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

/** Days from `listedAt` to `asOf`, null when the listing date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Median of a non-empty list; the list is sorted in place by the caller. */
function medianOf(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The p-th quantile (linear interpolation) of a sorted list. */
function quantileOf(sorted: number[], p: number): number {
  if (sorted.length === 1) return sorted[0]!;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** A peer's market-cap / TVL multiple; null when the protocol cannot be a peer. */
function peerMultiple(p: SnapshotProtocol): number | null {
  if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) return null;
  return p.mcap_usd / p.tvl_usd;
}

export interface PeerStats {
  category: string;
  n: number;
  median: number;
  p25: number;
  p75: number;
  global: boolean;
}

/** The peer table: one median multiple per category with enough live peers, else the global one. */
export function peerTable(protocols: SnapshotProtocol[]): { byCategory: Map<string, PeerStats>; global: PeerStats } {
  const live = protocols.filter((p) => p.category !== 'CEX' && peerMultiple(p) !== null);
  const allMultiples = live.map((p) => peerMultiple(p)!).sort((a, b) => a - b);
  const global: PeerStats = {
    category: 'All live-token protocols',
    n: allMultiples.length,
    median: medianOf(allMultiples),
    p25: quantileOf(allMultiples, 0.25),
    p75: quantileOf(allMultiples, 0.75),
    global: true,
  };
  const byCategory = new Map<string, PeerStats>();
  const cats = new Set(live.map((p) => p.category ?? 'Uncategorised'));
  for (const cat of cats) {
    const ms = live
      .filter((p) => (p.category ?? 'Uncategorised') === cat)
      .map((p) => peerMultiple(p)!)
      .sort((a, b) => a - b);
    if (ms.length >= MODEL.min_peers) {
      byCategory.set(cat, { category: cat, n: ms.length, median: medianOf(ms), p25: quantileOf(ms, 0.25), p75: quantileOf(ms, 0.75), global: false });
    }
  }
  return { byCategory, global };
}

/** The peer stats a protocol's category earns, or the global table when too few peers. */
export function peersFor(p: SnapshotProtocol, table: { byCategory: Map<string, PeerStats>; global: PeerStats }): PeerStats {
  return table.byCategory.get(p.category ?? 'Uncategorised') ?? table.global;
}

/** The three adjustments, from the protocol's own record only. */
export function adjustments(p: SnapshotProtocol, asOf: string, model: ModelConstants): { growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = clamp(rawGrowth, model.growth_floor, model.growth_cap);
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageUsed = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (clamp(ageUsed, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + Math.min(Math.max(p.chains.length - 1, 0), model.breadth_cap_chains) * model.breadth_step;
  return { growthPct, growthMult, maturityMult, breadthMult, age };
}

export interface Valuation {
  implied: number;
  low: number;
  high: number;
  multiple: number;
  multipleLow: number;
  multipleHigh: number;
  peerCount: number;
  peerGlobal: boolean;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/**
 * Implied value = TVL x category-median multiple x growth x maturity x breadth.
 * Low/high use the peers' first/third quartile multiples with the same adjustments.
 */
export function valueProtocol(p: SnapshotProtocol, asOf: string, table: { byCategory: Map<string, PeerStats>; global: PeerStats }, model: ModelConstants = MODEL): Valuation {
  const peers = peersFor(p, table);
  const adj = adjustments(p, asOf, model);
  const scale = adj.growthMult * adj.maturityMult * adj.breadthMult;
  return {
    implied: Math.max(1, Math.round(p.tvl_usd * peers.median * scale)),
    low: Math.max(1, Math.round(p.tvl_usd * peers.p25 * scale)),
    high: Math.max(1, Math.round(p.tvl_usd * peers.p75 * scale)),
    multiple: round4(peers.median),
    multipleLow: round4(peers.p25),
    multipleHigh: round4(peers.p75),
    peerCount: peers.n,
    peerGlobal: peers.global,
    growthPct: adj.growthPct,
    growthMult: round4(adj.growthMult),
    maturityMult: round4(adj.maturityMult),
    breadthMult: round4(adj.breadthMult),
    age: adj.age,
  };
}

/** Whether the snapshot records no token for this protocol. Never "has no token". */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** Rankable early rows: pre-token, not an exchange, not a wrapped/staked/bridged product, not a versioned pool. */
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
  peer_global: boolean;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
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
  peer_multiple_p25: number;
  peer_multiple_p75: number;
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

/**
 * Backtest, leave-one-out: every live-token protocol (except exchanges) is
 * scored as if it recorded no token, with its own multiple removed from its
 * peer set, and the prediction is compared with its actual market cap.
 * The numbers are the model's calibration, reported as measured.
 */
export function backtest(snapshot: Snapshot, table: { byCategory: Map<string, PeerStats>; global: PeerStats }): Backtest {
  const live = snapshot.protocols.filter((p) => p.category !== 'CEX' && peerMultiple(p) !== null);
  const absErrs: number[] = [];
  const signedErrs: number[] = [];
  let covered = 0;
  for (const p of live) {
    const others = live.filter((q) => q.slug !== p.slug);
    const sub = peerTable(others);
    const v = valueProtocol(p, snapshot.as_of, sub);
    const actual = p.mcap_usd!;
    absErrs.push(Math.abs(v.implied - actual) / actual);
    signedErrs.push((v.implied - actual) / actual);
    if (v.low <= actual && actual <= v.high) covered++;
  }
  absErrs.sort((a, b) => a - b);
  signedErrs.sort((a, b) => a - b);
  return {
    n: live.length,
    median_abs_error_pct: Math.round(medianOf(absErrs) * 1000) / 10,
    median_signed_error_pct: Math.round(medianOf(signedErrs) * 1000) / 10,
    band_coverage_pct: live.length === 0 ? 0 : Math.round((covered / live.length) * 1000) / 10,
    peer_multiple_p25: round4(table.global.p25),
    peer_multiple_p75: round4(table.global.p75),
    method: 'Leave-one-out: each live-token protocol scored as if pre-token, its own multiple removed from its peer set, prediction vs actual market cap.',
  };
}

/** The five same-category live peers whose TVL sits closest to the protocol's (log distance). */
function closestPeers(p: SnapshotProtocol, snapshot: Snapshot): PeerComp[] {
  const target = Math.log(Math.max(1, p.tvl_usd));
  return snapshot.protocols
    .filter((q) => q.slug !== p.slug && q.category === p.category && peerMultiple(q) !== null)
    .map((q) => ({ q, d: Math.abs(Math.log(Math.max(1, q.tvl_usd)) - target) }))
    .sort((a, b) => a.d - b.d || (a.q.slug < b.q.slug ? -1 : 1))
    .slice(0, 5)
    .map(({ q }) => ({ slug: q.slug, name: q.name, tvl_usd: q.tvl_usd, mcap_usd: q.mcap_usd, multiple: round4(peerMultiple(q)!) }));
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

/** The board: every watchlist slug, plus the strongest rankable pre-token rows below the floor. */
export function buildBoard(snapshot: Snapshot, table: { byCategory: Map<string, PeerStats>; global: PeerStats }): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd);
  for (const p of early) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, table) }));
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
    peer_global: s.v.peerGlobal,
    growth_multiplier: s.v.growthMult,
    maturity_multiplier: s.v.maturityMult,
    breadth_multiplier: s.v.breadthMult,
    peers: closestPeers(s.p, snapshot),
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
      multiple: peerMultiple(p) === null ? null : round4(peerMultiple(p)!),
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
  const table = peerTable(snapshot.protocols);
  const board = buildBoard(snapshot, table);
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
    backtest: backtest(snapshot, table),
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
