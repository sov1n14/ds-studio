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
const labels = captures.map(c => c.label);

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

if (matchedNowhere.length > 0) {
  console.log(`\n## Matched nowhere (0 in every scenario)\n`);
  for (const key of matchedNowhere) {
    const sel = captures[0]?.counts[key]?.selector ?? '?';
    console.log(`- ${key}: \`${sel}\``);
  }
}

console.log(`\n${sortedKeys.length} constants × ${labels.length} scenario(s). ${matchedNowhere.length} matched nowhere.`);
