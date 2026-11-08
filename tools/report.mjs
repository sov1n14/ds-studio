#!/usr/bin/env node
/**
 * Aggregator — reads tools/captures/*.json and prints a markdown matrix
 * of constant × scenario counts. Constants matching 0 everywhere are
 * called out in a "matched nowhere" list.
 *
 * Usage: node tools/report.mjs
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = join(__dirname, 'captures');

// ── Load all capture JSONs ─────────────────────────────────────────

let files;
try {
  files = readdirSync(CAPTURES_DIR).filter(f => f.endsWith('.json')).sort();
} catch {
  console.error('No captures directory found. Run capture.mjs first.');
  process.exit(1);
}

if (files.length === 0) {
  console.error('No .json captures found in tools/captures/.');
  process.exit(1);
}

const captures = files.map(f => JSON.parse(readFileSync(join(CAPTURES_DIR, f), 'utf-8')));
const labels = captures.map(c => c.mobile ? `${c.label} [mobile]` : c.label);

// Collect all constant names across all captures
const allKeys = new Set();
for (const c of captures) {
  for (const key of Object.keys(c.counts)) allKeys.add(key);
}
const sortedKeys = [...allKeys].sort();

// ── Print matrix ───────────────────────────────────────────────────

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

const nameCol = Math.max(40, ...sortedKeys.map(k => k.length + 2));
const dataCol = Math.max(6, ...labels.map(l => l.length + 2));

// Header
let header = pad('Constant', nameCol);
for (const l of labels) header += rpad(l, dataCol);
console.log(header);
console.log('-'.repeat(header.length));

const matchedNowhere = [];

for (const key of sortedKeys) {
  let row = pad(key, nameCol);
  let anyNonZero = false;
  for (const c of captures) {
    const entry = c.counts[key];
    const val = entry ? entry.count : '-';
    if (val > 0) anyNonZero = true;
    row += rpad(val === undefined ? '-' : val, dataCol);
  }
  console.log(row);
  if (!anyNonZero) matchedNowhere.push(key);
}

// ── Matched-nowhere summary ────────────────────────────────────────

// Accepted in DECISIONS: these selectors only match on page states the sweep does not reach, so 0 everywhere is expected.
const ACCEPTED_MATCHED_NOWHERE = [
  'CONTINUE_BUTTON_FALLBACK_SELECTOR',
  'CONTINUE_BUTTON_SELECTOR',
  'EXPAND_BUTTON_CONTAINER_SELECTOR',
  'EXPAND_BUTTON_ICON_SELECTOR',
  'RETRY_BUTTON_SELECTOR',
];

const selectorOf = key => captures.find(c => c.counts[key])?.counts[key].selector ?? '?';

console.log(`\n## Accepted matched-nowhere (need special page states)\n`);
for (const key of ACCEPTED_MATCHED_NOWHERE) {
  const matchedIn = captures
    .map((c, i) => ({ label: labels[i], count: c.counts[key]?.count }))
    .filter(m => m.count > 0);
  let status;
  if (!allKeys.has(key)) status = 'NOT IN CAPTURES (constant missing from sweep)';
  else if (matchedIn.length === 0) status = 'matched nowhere (as accepted)';
  else status = `MATCHED in ${matchedIn.map(m => `${m.label}=${m.count}`).join(', ')} (no longer matched-nowhere)`;
  console.log(`- ${key}: ${status} — \`${selectorOf(key)}\``);
}

const unexpected = matchedNowhere.filter(key => !ACCEPTED_MATCHED_NOWHERE.includes(key));
console.log(`\n## Unexpected matched-nowhere\n`);
if (unexpected.length === 0) {
  console.log('- (none)');
} else {
  for (const key of unexpected) console.log(`- ${key}: \`${selectorOf(key)}\``);
}

console.log(`\n${sortedKeys.length} constants × ${labels.length} scenario(s). ${matchedNowhere.length} matched nowhere (${unexpected.length} unexpected).`);
