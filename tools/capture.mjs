#!/usr/bin/env node
/**
 * Capture harness — launches a headed Playwright persistent context,
 * runs scenarios, writes HTML + JSON artifacts to tools/captures/.
 *
 * Usage:
 *   node tools/capture.mjs                 # all 11 scenarios
 *   node tools/capture.mjs new-chat        # only named labels
 */

import { chromium } from 'playwright';
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { scenarios } from './scenarios.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CAPTURES_DIR = join(__dirname, 'captures');
const PROFILE_DIR = join(__dirname, '.pw-profile');

// ── Load real selectors from the extension source ──────────────────

const require = createRequire(import.meta.url);
const DSSelectors = require('../content/ds-selectors.js');

// ── Selector normalizer ────────────────────────────────────────────

/**
 * Turn an exported constant value into a valid querySelectorAll argument.
 * Returns null for values that can't sensibly become selectors.
 */
function normalizeToSelector(value) {
  if (typeof value !== 'string') return null;           // arrays, etc.
  if (/^[A-Z]/.test(value)) return null;                // SVG path data like 'M7.999...'
  if (/^data-/.test(value)) return null;                // bare attribute name
  if (/[.#\[\]*:>,=]/.test(value)) return value;        // already a selector
  // Bare HTML tag names
  const tags = ['textarea', 'div', 'span', 'a', 'svg', 'input', 'button', 'select', 'form'];
  if (tags.includes(value)) return value;
  // Space-separated multi-class → compound selector
  if (value.includes(' ')) {
    return value.split(/\s+/).map(c => '.' + c).join('');
  }
  // Single bare class name
  return '.' + value;
}

// Build the selector map once
const selectorMap = {};   // { CONST_NAME: resolvedSelectorString }
const skippedKeys = [];
for (const [key, value] of Object.entries(DSSelectors)) {
  const sel = normalizeToSelector(value);
  if (sel) {
    selectorMap[key] = sel;
  } else {
    skippedKeys.push(key);
  }
}

console.log(`Loaded ${Object.keys(selectorMap).length} selectors, skipped ${skippedKeys.length}: ${skippedKeys.join(', ')}`);

// ── Helpers ────────────────────────────────────────────────────────

function promptUser(msg) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const timer = setTimeout(() => {
      console.log('  (no stdin — auto-continuing after 3 s)');
      rl.close();
      resolve();
    }, 3000);
    rl.question(msg, () => { clearTimeout(timer); rl.close(); resolve(); });
    rl.on('close', () => { clearTimeout(timer); resolve(); });
  });
}

async function captureArtifacts(page, label) {
  mkdirSync(CAPTURES_DIR, { recursive: true });

  // 1. Raw HTML
  const html = await page.evaluate(() => document.documentElement.outerHTML);
  writeFileSync(join(CAPTURES_DIR, `${label}.html`), html, 'utf-8');

  // 2. Selector match report — pass the map into the browser and count
  const counts = await page.evaluate((map) => {
    const result = {};
    for (const [key, sel] of Object.entries(map)) {
      try {
        result[key] = { selector: sel, count: document.querySelectorAll(sel).length };
      } catch {
        result[key] = { selector: sel, count: -1, error: 'invalid selector' };
      }
    }
    return result;
  }, selectorMap);

  const report = {
    label,
    url: page.url(),
    capturedAt: new Date().toISOString(),
    counts,
  };
  writeFileSync(join(CAPTURES_DIR, `${label}.json`), JSON.stringify(report, null, 2), 'utf-8');

  const total = Object.keys(counts).length;
  const nonZero = Object.values(counts).filter(c => c.count > 0).length;
  console.log(`  → ${label}: ${nonZero}/${total} selectors matched (HTML ${(html.length / 1024).toFixed(0)} KB)`);
}

// ── Main ───────────────────────────────────────────────────────────

const requestedLabels = process.argv.slice(2);
const toRun = requestedLabels.length
  ? scenarios.filter(s => requestedLabels.includes(s.label))
  : scenarios;

if (toRun.length === 0) {
  console.error('No matching scenarios. Available:', scenarios.map(s => s.label).join(', '));
  process.exit(1);
}

// Group scenarios that share a page session
const groups = new Map();
for (const s of toRun) {
  if (!groups.has(s.group)) groups.set(s.group, []);
  groups.get(s.group).push(s);
}

console.log(`Running ${toRun.length} scenario(s) in ${groups.size} group(s)...`);

const context = await chromium.launchPersistentContext(PROFILE_DIR, {
  headless: false,
  viewport: { width: 1440, height: 900 },
  args: ['--disable-blink-features=AutomationControlled'],
});

try {
  for (const [groupId, groupScenarios] of groups) {
    const page = await context.newPage();
    try {
      for (const scenario of groupScenarios) {
        console.log(`\n[${scenario.label}] ${scenario.description}`);
        let manual = false;
        try {
          await scenario.run(page);
        } catch (err) {
          console.error(`  ✗ Automation failed: ${err.message}`);
          console.log(`  → Please manually put the browser into the "${scenario.description}" state.`);
          await promptUser('  Press Enter when ready to capture...');
          manual = true;
        }

        await captureArtifacts(page, scenario.label);

        if (manual) {
          const jsonPath = join(CAPTURES_DIR, `${scenario.label}.json`);
          const raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
          raw.manual = true;
          writeFileSync(jsonPath, JSON.stringify(raw, null, 2), 'utf-8');
        }
      }
    } finally {
      await page.close();
    }
  }
} finally {
  await context.close();
}

console.log('\nDone. Artifacts in tools/captures/');
