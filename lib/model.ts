// Token Radar, scoring core for model radar-2 — a fresh implementation.
//
// One sealed snapshot goes in; one ranked board comes out. The board ranks
// every pre-token protocol the snapshot can rank (289 rows on the sealed
// input): the watchlist is a floor, never a ceiling, and every other
// rankable protocol below the floor joins it. Protocols that already trade
// are kept apart — the dashboard shows their market caps as facts, never
// as model output.
//
// A row's implied value is a product of four readings of the snapshot's
// own numbers and nothing else:
//
//   size      tvl_usd * 0.30
//             TVL anchors the launch's scale: a token's fully diluted value
//             is conventionally a fraction of the value already locked.
//
//   momentum  1 + clamp(change_7d, -50, 150) / 100 * 0.75
//             Seven-day TVL change, clamped so one wild week cannot decide
//             the ranking. A +150% week roughly doubles value; a -50% week
//             cuts it by more than a third.
//
//   age       0.55 + min(age_days, 1460) / 1460 * 0.45
//             Days since first listed with no token, capped at four years.
//             Older no-token protocols have survived longer and built a
//             larger claim on a launch. Unknown age counts as 365 days.
//
//   reach     1 + min(chains - 1, 4) * 0.03
//             Each chain beyond the first, up to four, adds 3%: a wider
//             distribution surface for a launch, never the driver.
//
//   implied   max(1, round(size * momentum * age * reach))
//
// The weights are deliberately lopsided: TVL decides the order of
// magnitude, momentum is the strongest correction, age is a slow ramp and
// chain count is a tilt. No protocol name is ever special-cased — the same
// arithmetic scores every row, and the dashboard inlines the same
// arithmetic so the page and the board can be checked against each other.
//
// A farm plan is derived the same way: the category picks the opening move
// and the weekly habit, TVL sizes the capital, age sizes the hold, and the
// chain list decides whether a second-chain step appears. Seven steps,
// every one costed and timed, none hand-written per protocol.

/** One protocol entry from the sealed snapshot: exactly its ten fields. */
export interface SnapshotProtocol {
  slug: string; // DefiLlama slug — the row's stable key
  name: string; // Display name; never used to score, only to label
  category: string | null; // DefiLlama category, or null when uncategorised
  chains: string[]; // Chains the protocol runs on, in snapshot order
  tvl_usd: number; // Total value locked, in US dollars
  change_7d: number | null; // Seven-day TVL change in per cent, or null
  mcap_usd: number | null; // Market cap when a token trades, else null
  listed_at: string | null; // First-listed date (YYYY-MM-DD), or null
  gecko_id: string | null; // CoinGecko id when a token trades, else null
  symbol: string | null; // Token symbol when a token trades, else null
}

/** The whole snapshot document the sealed input carries. */
export interface Snapshot {
  as_of: string; // Snapshot date (YYYY-MM-DD)
  source: string; // Where the snapshot came from
  floor_usd: number; // Watchlist floor: minimum TVL, in US dollars
  protocols: SnapshotProtocol[]; // Every protocol in the index
  watchlist: string[]; // Slugs the watchlist names, in order
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number; // Fraction of TVL a launch is worth
  growth_weight: number; // How much seven-day growth moves value
  growth_floor: number; // Lowest seven-day change the model credits
  growth_cap: number; // Highest seven-day change the model credits
  maturity_floor: number; // Multiplier of a protocol listed yesterday
  maturity_range: number; // Extra multiplier earned over four years
  maturity_days: number; // Days for the maturity ramp to finish
  unknown_age_days: number; // Age assumed when listed_at is missing
  breadth_step: number; // Multiplier added per extra chain
  breadth_cap_chains: number; // Extra chains that count, at most
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.75,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  breadth_step: 0.03,
  breadth_cap_chains: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string; // What to do, in plain words
  cost: string; // Capital and gas the step needs
  time: string; // How long the step takes
}

/** One row of board.json: a ranked pre-token protocol. */
export interface BoardRow {
  rank: number; // 1-based position, strongest implied value first
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
  token_status: 'pre-token'; // Every board row is pre-token by construction
  age_days: number | null; // Days listed with no token, or null
  implied_value_usd: number; // The model's estimate, in US dollars
  model: {
    base_multiple: number; // The multiple actually applied
    growth_pct: number; // Seven-day change after clamping
    growth_multiplier: number; // Momentum multiplier, rounded to 4dp
    maturity_multiplier: number; // Age multiplier, rounded to 4dp
    breadth_multiplier: number; // Chain-count multiplier, rounded to 4dp
    age_days: number | null; // Age the model used, or null
  };
  farm_steps: string[]; // The seven-step plan, as display strings
}

/** A board row in the dashboard's compact form; the page rebuilds the plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null; // The market's own value, not a model estimate
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number; // How many slugs the watchlist names
  watchlist: string[];
  board_size: number; // Rows on the ranked board
  early_size: number; // Board rows below the watchlist floor
  live_size: number; // Live-token protocols set aside
  rows: RadarRow[];
  live: LiveRow[];
}

/** The headline figures: watchlist size, board size, early and live counts. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Raised when the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** `value` when it is a finite number, `fallback` otherwise. */
function asFinite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `from` to `to`, never below zero; null when a date is missing or unparsable. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  const days = Math.floor((end - start) / DAY_MS);
  return days < 0 ? 0 : days;
}

/** Rounds to four decimal places for the multipliers the board publishes. */
function to4dp(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Slug order for ties: plain lexicographic, smaller first. */
function compareSlug(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The score of one protocol: implied value plus every multiplier that built it. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  // Momentum: the week's change, clamped, then weighted. A missing figure counts as flat.
  const weekly = asFinite(protocol.change_7d, 0);
  const growthPct = Math.max(model.growth_floor, Math.min(model.growth_cap, weekly));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  // Maturity: a slow ramp from the floor to floor + range over four years.
  const ageUsed = age === null ? model.unknown_age_days : age;
  const aged = Math.max(0, Math.min(ageUsed, model.maturity_days));
  const maturityMult = model.maturity_floor + (aged / model.maturity_days) * model.maturity_range;
  // Reach: each chain beyond the first adds a step, up to the cap.
  const extra = Math.max(0, Math.min(protocol.chains.length - 1, model.breadth_cap_chains));
  const breadthMult = 1 + extra * model.breadth_step;
  // Size anchors everything; the product is floored at one dollar.
  const base = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a release marker is a versioned pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** True when a protocol records no token at all — no cap, no id, no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The protocols the board ranks, strongest implied value first, ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const picked = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names that the snapshot
  // carries is in, in watchlist order. A slug the snapshot no longer
  // carries contributes nothing — it cannot be scored, so it is skipped
  // rather than invented.
  for (const slug of snapshot.watchlist) {
    const found = bySlug.get(slug);
    if (found !== undefined) picked.set(slug, found);
  }
  // Below the floor: the FULL rankable universe, biggest TVL first, slug
  // order breaking ties. Nothing is capped at a top-N; a picked protocol
  // stays picked and is not picked twice.
  const belowFloor = snapshot.protocols
    .filter((p) => !picked.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || compareSlug(a.slug, b.slug));
  for (const p of belowFloor) picked.set(p.slug, p);

  const scored = [...picked.values()].map((p) => {
    const value = impliedValue(p, snapshot.as_of, model);
    return { protocol: p, value };
  });
  scored.sort((a, b) => b.value.implied - a.value.implied || compareSlug(a.protocol.slug, b.protocol.slug));
  return scored.map((s, i) => toBoardRow(s.protocol, s.value, i + 1, model));
}

/** One scored protocol as the board.json row, with the model's own figures attached. */
function toBoardRow(
  p: SnapshotProtocol,
  value: { implied: number; growthPct: number; growthMult: number; maturityMult: number; breadthMult: number; age: number | null },
  rank: number,
  model: ModelConstants,
): BoardRow {
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    age_days: value.age,
    implied_value_usd: value.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: value.growthPct,
      growth_multiplier: to4dp(value.growthMult),
      maturity_multiplier: to4dp(value.maturityMult),
      breadth_multiplier: to4dp(value.breadthMult),
      age_days: value.age,
    },
    farm_steps: farmSteps(p, value.age).map(stepText),
  };
}

/** One step as a display string: action, then cost and time, within 20..600 characters. */
export function stepText(step: FarmStep): string {
  let rendered = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (rendered.length > 600) rendered = `${rendered.slice(0, 596)}...`;
  if (rendered.length < 20) rendered = `${rendered} Hold the position and check the protocol's own page.`;
  return rendered;
}

/** The protocol's first chain, or a neutral phrase when it names none. */
function primaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The protocol's second chain, or null when it runs on one chain only. */
function secondaryChain(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** Capital tiers, biggest TVL first: the first tier the TVL reaches wins. */
const CAPITAL_TIERS: Array<[number, number]> = [
  [5_000_000_000, 250],
  [1_000_000_000, 150],
  [100_000_000, 100],
];

/** How much capital one farm position needs, from the protocol's own TVL. */
function stakeSize(p: SnapshotProtocol): number {
  for (const [floor, size] of CAPITAL_TIERS) {
    if (p.tvl_usd >= floor) return size;
  }
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdWindow(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * Category playbook: each entry names the category words it answers and the
 * opening move for that category. The first entry whose words appear in the
 * lower-cased category wins, so order is the priority. The fallback entry
 * has no words and always matches.
 */
type MoveFn = (capital: number, name: string, chain: string) => string;
const OPENING_MOVES: Array<{ words: string[]; move: MoveFn }> = [
  {
    words: ['lend', 'cdp', 'collateral'],
    move: (capital, name, chain) => `Supply $${capital} of USDC to ${name} on ${chain}, then borrow $20 of USDC against it and keep both legs open.`,
  },
  {
    words: ['dex', 'leveraged farm'],
    move: (capital, name, chain) => `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} in the $USDC pair and keep the position open.`,
  },
  {
    words: ['bridge', 'canonical'],
    move: (capital, name, chain) => `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in an app on ${chain}.`,
  },
  {
    words: ['liquid staking', 'restak', 'staking pool'],
    move: (capital, name, chain) => `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`,
  },
  {
    words: ['perpetual', 'derivative', 'basis', 'option'],
    move: (capital, name, chain) => `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged trade.`,
  },
  {
    words: ['prediction'],
    move: (capital, name, chain) => `Fund $${capital} and place one small market position on ${name} on ${chain}.`,
  },
  {
    words: ['curator', 'allocator', 'risk'],
    move: (capital, name, chain) => `Deposit $${capital} into a ${name} vault on ${chain} and keep the vault shares.`,
  },
  {
    words: ['stable'],
    move: (capital, name, chain) => `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`,
  },
  {
    words: ['rwa'],
    move: (capital, name, chain) => `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`,
  },
  {
    words: ['insurance'],
    move: (capital, name, chain) => `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`,
  },
  {
    words: ['yield'],
    move: (capital, name, chain) => `Deposit $${capital} into ${name}'s main yield strategy on ${chain} and keep the receipt.`,
  },
  {
    words: [],
    move: (capital, name, chain) => `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`,
  },
];

/** The category's opening move, in words a farmer can follow. */
function openingMove(p: SnapshotProtocol, capital: number, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of OPENING_MOVES) {
    if (entry.words.length === 0 || entry.words.some((w) => category.includes(w))) {
      return entry.move(capital, p.name, chain);
    }
  }
  return '';
}

/**
 * The weekly habit playbook: same shape as the opening moves, but only the
 * categories with a habit of their own get an entry — the rest fall through
 * to the generic habit. Note the stable, RWA and insurance categories have
 * an opening move but no weekly habit of their own.
 */
type HabitFn = (name: string, chain: string) => string;
const WEEKLY_HABITS: Array<{ words: string[]; habit: HabitFn }> = [
  {
    words: ['lend', 'cdp', 'collateral'],
    habit: (name) => `Each week, top up or repay $5 of the borrow on ${name} so the position shows fresh activity.`,
  },
  {
    words: ['dex', 'leveraged farm'],
    habit: (name, chain) => `Each week, swap $5 through ${name} on ${chain} and add or remove a little liquidity.`,
  },
  {
    words: ['bridge', 'canonical'],
    habit: (name, chain) => `Each week, bridge $5 through ${name} to ${chain} instead of moving everything at once.`,
  },
  {
    words: ['liquid staking', 'restak', 'staking pool'],
    habit: (name, chain) => `Each week, stake another $5 through ${name} on ${chain} and keep every receipt.`,
  },
  {
    words: ['perpetual', 'derivative', 'basis', 'option'],
    habit: (name, chain) => `Each week, open and close one $5 trade on ${name} on ${chain} and leave the margin in place.`,
  },
  {
    words: ['prediction'],
    habit: (name) => `Each week, place one $5 position on a new market on ${name}.`,
  },
  {
    words: ['curator', 'allocator', 'risk'],
    habit: (name, chain) => `Each week, add $5 to the ${name} vault on ${chain} or vote on its allocation if a vote is open.`,
  },
  {
    words: ['yield'],
    habit: (name, chain) => `Each week, claim or compound $5 of yield in ${name} on ${chain}.`,
  },
  {
    words: [],
    habit: (name) => `Each week, make one small qualifying action on ${name} — a deposit, a swap or a vote.`,
  },
];

/** The weekly qualifying action for the category: the habit that keeps the wallet visible. */
function weeklyHabit(p: SnapshotProtocol, chain: string): string {
  const category = (p.category ?? '').toLowerCase();
  for (const entry of WEEKLY_HABITS) {
    if (entry.words.length === 0 || entry.words.some((w) => category.includes(w))) {
      return entry.habit(p.name, chain);
    }
  }
  return '';
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a
 * time. The plan is derived from the protocol's own record (category,
 * chains, TVL, age), never from a hand-written list of names. Multi-chain
 * protocols get a second-chain step; single-chain ones get a diversification
 * note instead. Capital scales with TVL; the hold scales with age.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = primaryChain(p);
  const second = secondaryChain(p);
  const capital = stakeSize(p);
  const hold = holdWindow(age);
  const small = Math.max(20, Math.round(capital / 5));
  const chainStep: FarmStep =
    second === null
      ? {
          text: `${p.name} runs on ${chain} only, so keep the whole position there and do not split it across chains that the protocol does not support.`,
          cost: 'no extra gas beyond the main position',
          time: '5 minutes to check the chain list',
        }
      : {
          text: `Repeat a smaller $${small} position on ${second} through ${p.name} so the wallet is active on two of its chains.`,
          cost: `$${small} of capital and about $3 of gas`,
          time: '15 minutes to set up',
        };
  const plan: FarmStep[] = [];
  plan.push({
    text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
    cost: 'under $3 of gas for the first transaction',
    time: '5 minutes',
  });
  plan.push({
    text: openingMove(p, capital, chain),
    cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
    time: '15 minutes to set up',
  });
  plan.push(chainStep);
  plan.push({
    text: weeklyHabit(p, chain),
    cost: 'about $2 of gas a week',
    time: '10 minutes a week',
  });
  plan.push({
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  });
  plan.push({
    text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  });
  plan.push({
    text: `Write the wallet, the dates and every transaction in a farm log, then unwind in two halves instead of all at once.`,
    cost: 'nothing but the log, plus about $4 of exit gas',
    time: '10 minutes to unwind',
  });
  return plan;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((p) => !isPreToken(p) && p.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd,
    change_7d: p.change_7d,
  }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Reads one field that must be a string, or raises the snapshot error. */
function needText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string') throw new SnapshotError(`snapshot.json has no ${field}`);
  return value;
}

/** Reads one field that must be a positive safe integer, or raises the snapshot error. */
function needPositiveInt(record: Record<string, unknown>, field: string): number {
  const value = record[field];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new SnapshotError(`snapshot.json has no ${field}`);
  }
  return value;
}

/** A number field when it is finite, null otherwise. */
function optionalNumber(record: Record<string, unknown>, field: string): number | null {
  const value = record[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** A string field when it is one, null otherwise. */
function optionalText(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  return typeof value === 'string' ? value : null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  const asOf = doc.as_of;
  const source = needText(doc, 'source');
  const floor = needPositiveInt(doc, 'floor_usd');
  if (!Array.isArray(doc.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = doc.protocols.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = entry as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug as string,
      name: p.name as string,
      category: optionalText(p, 'category'),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number,
      change_7d: optionalNumber(p, 'change_7d'),
      mcap_usd: optionalNumber(p, 'mcap_usd'),
      listed_at: optionalText(p, 'listed_at'),
      gecko_id: optionalText(p, 'gecko_id'),
      symbol: optionalText(p, 'symbol'),
    };
  });
  return {
    as_of: asOf,
    source,
    floor_usd: floor,
    protocols,
    watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const onBoard = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !onBoard.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  const first = board[0];
  const last = board[board.length - 1];
  if (board.length >= 2 && first !== undefined && last !== undefined && first.implied_value_usd === last.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${first.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.implied_value_usd > 1e14) return `${row.slug} has implied value over 1e14`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
