# Token Launch Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/FUNATIC01/gem-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/FUNATIC01/gem-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Pre-token protocols ranked by implied launch value, scored from their own
numbers in a DefiLlama snapshot — no names are hard-coded, every row is
scored by the same model.

## What it does

`node main.ts` reads a snapshot (`--input`, or `/input/snapshot.json`) and
writes, into the output directory (`--output`, or `$MAKEFUN_OUTPUT_DIR`):

- `board.json` — every rankable pre-token protocol (198 rows on the
  2026-11-14 snapshot: the 40 watchlist slugs plus every other pre-token
  protocol that is not an exchange, not a wrapped/staked/bridged product
  and not a versioned pool, at any TVL), ranked by implied value, each
  with its band, its closest live peers and a 7-step farm plan.
- `data.js` — the same data as `window.RADAR` for the dashboard.
- `dashboard/` — the page: a sortable, filterable board, a detail view
  per protocol, a Method view and a live-token market view. No network.
- `screenshots/` — three 1440×900 PNGs of the board, a detail view and a
  filtered board.
- `dossier.json` — the make.fun dossier, built last with the kit's
  `vendor/makefun-board.ts`, byte-identical to what the scorer rebuilds.

## The model

Implied value = exp(Huber intercept + slope × log TVL + group correction +
chain correction). The fit is a Huber regression (k = 1.5, MAD scale, 20
IRLS rounds) of log market cap on log TVL over the live-token protocols
in the snapshot. The slope is near 0.4, not 1.0: market cap does not grow
one-for-one with TVL — the median multiple falls about 50× from $5m to
$900m+ of TVL, which is why a TVL-proportional rule overprices big
protocols and underprices small ones. The two corrections are shrunk
means of the fit's residuals for the protocol's business group (seven
groups folded from the snapshot's categories) and its primary chain
(τ = 0.8 each), because most groups and chains have few live peers.

Seven-day TVL growth, listing age and chain count are deliberately not
priced: each correlates with the log residual at |r| < 0.1, and the
previous radar's growth, maturity and breadth multipliers were measured
to be noise. The band is the point estimate times exp() of the 20th and
80th percentiles of the peer residuals — the central 60% of the peers'
own errors.

## Backtest (leave-one-out, n = 119)

Each live-token protocol is scored as if it recorded no token, with
itself removed from the peer set, and the prediction is compared with its
actual market cap. The previous radar is scored in the same loop.

| Metric | Radar-5 | Radar-4 |
| --- | --- | --- |
| Median absolute error | **80.1%** | 91.9% |
| Median signed error | +8.6% | +5.6% |
| Band coverage | **61.3%** | 38.7% |
| Spearman, predicted vs actual cap | **0.399** | 0.379 |

Honest limits: the peer multiples still spread over roughly two orders
of magnitude inside a group, so the point estimate is an order of
magnitude, not a price target. The 80.1% median error is better than
91.9% but still large; the board is a ranking with a calibrated band,
not a valuation. The 70% target in the original brief was not reached:
an exhaustive search of about fifty approaches, cross-checked with
5-fold validation, put the honest floor near 80–83% on this snapshot's
features, and the one route that appeared to reach 66.8% turned out to
leak the held-out protocol's own label through the leave-one-out loop,
so it was rejected. See `NOTES.md` for the full experiment trail.

## Who is on the board

The $50m floor is a floor, never a ceiling: the snapshot's own
documentation says a protocol the watchlist leaves out is no worse a
subject than one on it. The board therefore holds all 198 rankable
pre-token protocols, including 20 above the floor that are not on the
watchlist. The previous radar left those out on `parentProtocol`, a
field the snapshot does not carry, so that exclusion cannot be checked
from the snapshot.

## Checks

`node check.mjs --input path/to/snapshot.json` runs the gate bundle:
two fresh builds (byte-identical, runtime median ≤ 0.61 s), board shape
and watchlist coverage, backtest numbers against the verified values,
dashboard byte budget and zero network references, screenshot sizes and
dimensions, dossier budgets and byte-equality with `buildDossier`, and
an edge-case snapshot (null fields, empty chains). Exit 0 means every
check passed.

## Layout

- `main.ts` — entrypoint
- `lib/model.ts` — snapshot parsing, the model, the backtest, the board,
  farm plans, the dashboard dataset
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `dashboard/` — `index.html`, `app.css`, `app.js`
- `screenshots/` — `1-board.png`, `2-detail.png`, `3-filtered.png`
- `check.mjs` — the gate bundle
- `NOTES.md` — the experiment log
