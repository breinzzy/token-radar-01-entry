// A token-radar-01 entry (Node 22, standard library only).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>),
// fits the size curve and the token odds from the snapshot's own figures in lib/model.ts,
// writes the ranked board to /output/board.json, and copies this repository's dashboard/
// and screenshots/ to /output. Last, it writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// The dashboard is a static page, no framework and no network: dashboard/index.html,
// dashboard/app.css and dashboard/app.js read /output/data.js, which this program writes
// from the same board. The page recomputes every row from the snapshot figures, so the
// screenshots, the code and the board's data are visibly the same arithmetic.
//
// The build is deterministic: the board is built twice and written only when both runs are
// byte-identical, so the grader's two executions agree.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));

// Build twice: the board must be byte-identical across runs, or the grader's two
// executions would disagree and the entry fails run_deterministic.
const first = buildRadar(snapshot);
const second = buildRadar(snapshot);
const firstJson = JSON.stringify({ rows: first.board });
const secondJson = JSON.stringify({ rows: second.board });
if (firstJson !== secondJson) {
  process.stderr.write('token radar: the two builds disagree: the model is not deterministic\n');
  process.exit(1);
}
const { board, radar } = first;
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const boardText = `${firstJson}\n`;
writeFileSync(join(out, 'board.json'), boardText);
// The seal is the first 8 hex of the sha256 of board.json exactly as written: the
// dashboard prints it on its integrity strip, so a reader can check that the table
// on the page is the board this program wrote.
const seal = createHash('sha256').update(boardText).digest('hex').slice(0, 8);
writeFileSync(join(out, 'data.js'), dataScript(radar, seal));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const fit = radar.fit;
const odds = radar.odds;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live shown)\n` +
    `token radar: ln(mcap) = ${fit.coefs.map((c) => c.toFixed(4)).join(' + ')} [${fit.chosenTerms.join(', ')}], fit on ${fit.n} priced peers, R2 ${fit.r2.toFixed(3)}\n` +
    `token radar: kept "${fit.chosenLabel}" (LOO x${fit.chosen.loo.toFixed(2)}, walk-forward median x${fit.chosen.wfMed.toFixed(2)}, 60/40 x${fit.chosen.wf60.toFixed(2)}); range P25-P75 covers ${Math.round(fit.coverage2575 * 100)}%, P10-P90 ${Math.round(fit.coverage1090 * 100)}%\n` +
    `token radar: odds logistic on ${odds.n} aged peers, Brier 10-fold ${odds.brier10.toFixed(3)} / walk-forward ${odds.brierWf.toFixed(3)} vs base ${odds.brierBase10.toFixed(3)} / ${odds.brierBaseWf.toFixed(3)}, accuracy ${Math.round(odds.accuracy10 * 100)}%\n` +
    `token radar: verdicts FARM ${radar.verdicts.FARM}, MARGINAL ${radar.verdicts.MARGINAL}, SKIP ${radar.verdicts.SKIP}; audit ${radar.audit.ranked} + ${radar.audit.hasToken} + ${radar.audit.setAside} = ${radar.audit.total}\n` +
    `token radar: seal ${seal} (sha256 of board.json, first 8 hex)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (3 files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
