#!/usr/bin/env node
// Token launch radar, entrypoint: snapshot.json in, board.json, data.js,
// dashboard, screenshots and dossier.json out.
//
// Reads the snapshot, scores every rankable pre-token protocol with the
// model in lib/model.ts, and writes the artifacts the make.fun gate
// expects, in this order: board.json, data.js, the dashboard files, the
// screenshot placeholders (the PNGs are dropped in later from the browser
// pass), then dossier.json last, so the dossier always describes the
// artifacts it was built from. Exits non-zero on the first problem; a run
// that finishes is a run that passed its own self-check.
//
// Deterministic by construction: no clocks, no randomness, no network.
// The same snapshot must produce byte-identical output on every run, and
// main.ts checks that claim by never letting a run depend on its own
// history.
//
// Usage:
//   node main.ts --input path/to/snapshot.json --output path/to/outdir
//   node main.ts                          (input /input/snapshot.json,
//                                          output $MAKEFUN_OUTPUT_DIR)
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { parseSnapshot, buildRadar, boardIssue, dataScript } from './lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

function usage(): never {
  process.stderr.write('usage: node main.ts [--input path/to/snapshot.json] [--output path/to/outdir]\n');
  process.exit(2);
}

function valueOf(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1]! : null;
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.some((a) => a === '--help' || a === '-h')) usage();
  const input = valueOf(args, '--input') ?? '/input/snapshot.json';
  const output = valueOf(args, '--output') ?? process.env.MAKEFUN_OUTPUT_DIR ?? usage();
  const out = resolve(output);

  let snapshotText: string;
  try {
    snapshotText = readFileSync(input, 'utf8');
  } catch {
    fail(`cannot read ${input}`);
  }
  let snapshot;
  try {
    snapshot = parseSnapshot(snapshotText!);
  } catch (e) {
    fail(e instanceof Error ? e.message : 'snapshot is invalid');
  }

  const { board, radar } = buildRadar(snapshot!);
  const issue = boardIssue(board, snapshot!);
  if (issue !== null) fail(`board self-check failed: ${issue}`);

  const dashboardDir = join(here, 'dashboard');
  const screenshotDir = join(here, 'screenshots');

  mkdirSync(join(out, 'dashboard'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  writeFileSync(join(out, 'board.json'), `${JSON.stringify(board, null, 2)}\n`, 'utf8');
  writeFileSync(join(out, 'data.js'), dataScript(radar), 'utf8');
  for (const name of readdirSync(dashboardDir)) copyFileSync(join(dashboardDir, name), join(out, 'dashboard', name));
  for (const name of readdirSync(screenshotDir)) {
    if (!name.toLowerCase().endsWith('.png')) continue;
    copyFileSync(join(screenshotDir, name), join(out, 'screenshots', name));
  }
  const dossier = buildDossier(out, {
    text_max_bytes: 65_536,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  });
  writeFileSync(join(out, 'dossier.json'), dossier);
  if (!existsSync(join(out, 'dossier.json'))) fail('dossier.json was not written');

  process.stdout.write(
    `wrote ${board.length} rows (${radar.watchlist_size} watchlist, ${radar.early_size} early), ` +
    `backtest LOO n=${radar.backtest.n} median abs error ${radar.backtest.median_abs_error_pct}%, ` +
    `band coverage ${radar.backtest.band_coverage_pct}%, spearman ${radar.backtest.spearman} ` +
    `(radar-4 ${radar.backtest.radar4_median_abs_error_pct}% / ${radar.backtest.radar4_spearman})\n`,
  );
}

main();
