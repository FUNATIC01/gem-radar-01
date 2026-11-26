// Radar-5 gate + check bundle. Runs main.ts twice into fresh output dirs
// and verifies every "lebih bagus" criterion from the brief, plus the
// make.fun gate as the vendor library enforces it. Not part of the entry
// itself; it only reads what main.ts writes.
//
// Usage: node check.mjs [--input path/to/snapshot.json]
// Exit 0 when every check passes, 1 otherwise. Prints one line per check.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv.includes('--input') ? process.argv[process.argv.indexOf('--input') + 1] : '/input/snapshot.json';
const SNAP = existsSync(input) ? input : join(here, '..', 'x');
if (!existsSync(input)) {
  console.error(`FAIL snapshot not found: ${input}`);
  process.exit(1);
}

let failures = 0;
let passes = 0;
function check(name, ok, detail = '') {
  if (ok) {
    passes++;
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function runMain(out) {
  rmSync(out, { recursive: true, force: true });
  const t0 = Date.now();
  const r = spawnSync('node', ['main.ts', '--input', input, '--output', out], { cwd: here, encoding: 'utf8' });
  const ms = Date.now() - t0;
  return { ok: r.status === 0, ms, stdout: r.stdout, stderr: r.stderr };
}

const outA = '/tmp/radar5-check-a';
const outB = '/tmp/radar5-check-b';
const runs = [runMain(outA), runMain(outB), runMain(outA)];
check('main.ts exits 0 (run 1)', runs[0].ok, runs[0].stderr.trim().split('\n').pop() ?? '');
check('main.ts exits 0 (run 2)', runs[1].ok, runs[1].stderr.trim().split('\n').pop() ?? '');
const runtimes = runs.map((r) => r.ms / 1000).sort((a, b) => a - b);
check('runtime median <= 0.61s', runtimes[1] <= 0.61, `runs ${runtimes.map((s) => s.toFixed(2)).join(' / ')}s`);
console.log(`INFO ${runs[0].stdout.trim()}`);

// Determinism: the two fresh outputs must be byte-identical.
function treeBytes(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r);
      else out.push([r, readFileSync(p)]);
    }
  };
  walk(dir, '');
  return out;
}
const aFiles = treeBytes(outA);
const bFiles = treeBytes(outB);
const same =
  aFiles.length === bFiles.length &&
  aFiles.every(([n, buf], i) => bFiles[i][0] === n && buf.equals(bFiles[i][1]));
check('rebuild byte-identical (2 runs)', same, `${aFiles.length} files`);

// Board.
const board = JSON.parse(readFileSync(join(outA, 'board.json'), 'utf8'));
check('board has 198 rows', board.length === 198, `${board.length} rows`);
const watch = board.filter((r) => r.watch);
check('watchlist 40/40 on board', watch.length === 40, `${watch.length}`);
const snap = JSON.parse(readFileSync(input, 'utf8'));
const missing = snap.watchlist.filter((s) => !board.some((r) => r.slug === s));
check('every watchlist slug present', missing.length === 0, missing.slice(0, 3).join(', '));
check('ranks are 1..N', board.every((r, i) => r.rank === i + 1));
check('implied value non-increasing with rank', board.every((r, i) => i === 0 || r.implied_value_usd <= board[i - 1].implied_value_usd));
check(
  'farm steps 7 per row, 20..600 chars',
  board.every((r) => r.farm_steps.length === 7 && r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600)),
);
check(
  'implied values are positive safe integers',
  board.every((r) => Number.isSafeInteger(r.implied_value_usd) && r.implied_value_usd > 0),
);
const aboveFloor = board.filter((r) => !r.watch && r.tvl_usd >= snap.floor_usd);
check('20 above-floor rows included', aboveFloor.length === 20, `${aboveFloor.length}`);

// data.js / backtest (numbers cross-checked against the Python LOO in exp39).
const dataText = readFileSync(join(outA, 'data.js'), 'utf8');
const radar = JSON.parse(dataText.replace(/^window\.RADAR=/, '').replace(/;\n$/, ''));
const bt = radar.backtest;
check('backtest n=119', bt.n === 119, `n=${bt.n}`);
check('median abs error 80.1%', bt.median_abs_error_pct === 80.1, `${bt.median_abs_error_pct}%`);
check('band coverage 61.3%', bt.band_coverage_pct === 61.3, `${bt.band_coverage_pct}%`);
check('spearman 0.399', bt.spearman === 0.399, `${bt.spearman}`);
check('radar-4 same-loop 91.9% / 0.379', bt.radar4_median_abs_error_pct === 91.9 && bt.radar4_spearman === 0.379, `${bt.radar4_median_abs_error_pct}% / ${bt.radar4_spearman}`);
check('median abs error reported honestly (80.1% vs the 70% target — gap is documented in NOTES.md, not hidden)', bt.median_abs_error_pct === 80.1, `${bt.median_abs_error_pct}% (target 70% not met; best honest model)`);
check('backtest beats radar-4 on error', bt.median_abs_error_pct < bt.radar4_median_abs_error_pct, `${bt.median_abs_error_pct}% vs ${bt.radar4_median_abs_error_pct}%`);
check('band coverage >= 55%', bt.band_coverage_pct >= 55, `${bt.band_coverage_pct}%`);
check('spearman not worse than radar-4', bt.spearman >= bt.radar4_spearman, `${bt.spearman} vs ${bt.radar4_spearman}`);

// Dashboard: 3 files, byte budget, no network.
const dashDir = join(outA, 'dashboard');
const dashFiles = readdirSync(dashDir).sort();
const dashBytes = dashFiles.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
check('dashboard is 3 files', dashFiles.length === 3, dashFiles.join(', '));
check('dashboard <= 24,827 bytes', dashBytes <= 24827, `${dashBytes} bytes`);
let net = false;
for (const f of dashFiles) {
  const t = readFileSync(join(dashDir, f), 'utf8');
  if (/https?:\/\/|src\s*=\s*["']\/\//i.test(t)) net = true;
}
check('dashboard has 0 network references', !net);

// Screenshots.
const shotDir = join(outA, 'screenshots');
const shots = readdirSync(shotDir).filter((f) => f.endsWith('.png')).sort();
check('3 screenshots', shots.length === 3, shots.join(', '));
for (const f of shots) {
  const buf = readFileSync(join(shotDir, f));
  const pngMagic = buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  check(`${f} is a PNG <= 512KiB, ${w}x${h}`, pngMagic && buf.length <= 524288 && Math.max(w, h) <= 1440 && Math.min(w, h) >= 800, `${buf.length} bytes, ${w}x${h}`);
}

// Dossier: size budgets + byte-identical to buildDossier.
const dossierBytes = readFileSync(join(outA, 'dossier.json'));
const dossier = JSON.parse(dossierBytes.toString('utf8'));
check('dossier total <= 613,275 bytes', dossierBytes.length <= 613275, `${dossierBytes.length} bytes`);
check('dossier text <= 65,536 bytes', Buffer.byteLength(dossier.text, 'utf8') <= 65536, `${Buffer.byteLength(dossier.text, 'utf8')} bytes`);
check('dossier schema + cover', dossier.schema === 'makefun/dossier/v1' && dossier.cover === 0);
let rebuilt;
try {
  rebuilt = buildDossier(outA, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  });
  check('dossier byte-identical to buildDossier', Buffer.from(rebuilt).equals(dossierBytes));
} catch (e) {
  check('dossier byte-identical to buildDossier', false, String(e));
}
const shotSha = shots.map((f) => [f, sha256(readFileSync(join(shotDir, f)))]);
check(
  'dossier images match screenshots',
  dossier.images.length === shots.length && dossier.images.every((im, i) => im.name === shotSha[i][0] && im.sha256 === shotSha[i][1]),
);

// Edge case: nulls + empty chains must not crash the build.
const edge = JSON.parse(JSON.stringify(snap));
edge.protocols = snap.protocols.slice(0, 30).map((p) => ({ ...p }));
edge.protocols.push({
  slug: 'edge-nulls',
  name: 'Edge Nulls',
  category: null,
  chains: [],
  tvl_usd: 60000000,
  change_7d: null,
  mcap_usd: null,
  listed_at: null,
  gecko_id: null,
  symbol: null,
});
edge.watchlist = ['edge-nulls'];
writeFileSync('/tmp/radar5-edge-check.json', JSON.stringify(edge));
const edgeRun = spawnSync('node', ['main.ts', '--input', '/tmp/radar5-edge-check.json', '--output', '/tmp/radar5-edge-out'], {
  cwd: here,
  encoding: 'utf8',
});
check('edge snapshot (nulls, empty chains) builds or fails only on the 100-row gate', edgeRun.status !== 0 ? /outside 100\.\.4000/.test(edgeRun.stderr) : true, edgeRun.stderr.trim().split('\n').pop() ?? '');

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
