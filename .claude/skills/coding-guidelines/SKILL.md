---
name: coding-guidelines
description: Chrome Extension coding standard — MUST consult when writing, reviewing, or refactoring extension code including: popup scripts, content scripts, service workers, utils, manifest.json, tests, and docs. Triggers on MV3 architecture questions, storage patterns, message passing, layer separation, and PR reviews. Does NOT apply to non-extension programming. For version bump standards, use the `version-bump` skill.
---

## 1. Layer Separation (MANDATORY)

**Why it matters:** Each Chrome Extension layer runs in a different execution context with different API access. Mixing layers creates untestable, fragile code that breaks when Chrome updates its isolation model.

**MANDATORY directory structure:**
- `popup/` — UI entry point only. Reads user inputs, calls utility functions, renders results. **NO** `chrome.*` API calls except `chrome.runtime.sendMessage` (and even that should go through a utility abstraction). **NO** business logic.
- `background/` (Service Worker) — Lifecycle management, cross-tab coordination, alarms, and message routing only. **NO** DOM access. **NO** direct storage reads for UI data.
- `content/` — DOM interaction and page-level injection only. Communicates via `chrome.runtime.sendMessage`. **NO** `chrome.storage`, **NO** `chrome.alarms`, **NO** service-worker-only APIs. Access settings by messaging the background script.
- `utils/` — All reusable logic (storage, formatting, API calls, validation). Must be layer-agnostic and importable by any layer. **NO** DOM references. **NO** layer-specific `chrome.*` APIs.

**Concrete anti-patterns (DO NOT DO):**
- ❌ `popup/popup.js` calling `chrome.storage.sync.get()` directly — belongs in `utils/storage-manager.js`
- ❌ `content/` script registering `chrome.alarms.onAlarm` listeners — alarms belong in `background/`
- ❌ `popup/` handler doing validation AND storage AND messaging AND UI updates — split into utils + view

**Correct pattern:**
```javascript
// ❌ BAD: popup/popup.js
document.getElementById('save').onclick = async () => {
  await chrome.storage.sync.set({ key: 'value' });     // storage in popup
  await chrome.runtime.sendMessage({ type: 'RELOAD' }); // messaging in popup
  document.getElementById('status').textContent = 'OK';  // OK — this IS UI work
};

// ✅ GOOD: utils/storage-manager.js
export async function saveSettings(data) { return chrome.storage.sync.set(data); }

// ✅ GOOD: utils/messaging.js
export async function sendReload() { return chrome.runtime.sendMessage({ type: 'RELOAD' }); }

// ✅ GOOD: popup/popup.js
import { saveSettings } from '../utils/storage-manager.js';
import { sendReload } from '../utils/messaging.js';
document.getElementById('save').onclick = async () => {
  await saveSettings({ key: 'value' });
  await sendReload();
  document.getElementById('status').textContent = 'OK';
};
```

---

## 2. Core Code Quality

### Guard Clauses (Fail Fast) — MANDATORY

Validate inputs at the top of every function. Return or throw immediately on failure. Never nest validation inside the main logic path.

```javascript
// ✅ CORRECT: Guard clauses at the top
function processMessage(message) {
  if (!message) throw new Error('message is required');
  if (!message.type) throw new Error('message.type is required');

  // Core logic proceeds without nesting
  handleByType(message);
}

// ❌ FORBIDDEN: Deep nesting of validation
function processMessage(message) {
  if (message) {
    if (message.type) {
      handleByType(message);
    }
  }
}
```

### Naming — MANDATORY
- Use clear, descriptive, unambiguous names for all variables, functions, and modules.
- Boolean variables MUST use `is`/`has`/`can` prefix (e.g., `isEnabled`, `hasPermission`).

### Single Responsibility — MANDATORY
- Every function and module MUST have exactly one reason to change.
- A function that fetches data AND transforms it AND writes to storage is forbidden — split it.
- A module that handles DOM interaction AND storage management AND alarm events is forbidden.

### No Hidden Side Effects — MANDATORY
- A function that queries data MUST NOT also mutate state. Reads and writes are separate functions.
- Module-level side effects (code that runs on import) are FORBIDDEN unless explicitly documented and unavoidable.
- All observable behavior MUST be derivable from the function's name and signature.

### Composition Over Inheritance
- Favor composing small, focused functions and modules. Avoid class hierarchies deeper than one level.

---

## 3. Chrome Extension Manifest V3 Specifics

Manifest V3 has **strict rules** that differ from V2. These are non-negotiable:

### Service Worker Lifecycle
- Background scripts are now **non-persistent service workers**. They can be terminated by Chrome at any time.
- **DO NOT** rely on global state in service workers — use `chrome.storage` for anything that must persist across restarts.
- **DO NOT** use `window` or `document` in service workers — they don't exist.
- Register alarms and listeners at the top level of the service worker (they survive termination).

### Content Script Limitations
- Content scripts have **limited** `chrome.*` API access. Most APIs require messaging the service worker.
- **DO NOT** use `chrome.storage.sync/get` directly in content scripts — message the background script instead.
- Content scripts are isolated from page scripts (separate JS context) but share the DOM.
- **CSS isolation:** Use unique class prefixes or CSS Modules to avoid leaking styles into the host page.

### Offscreen Documents
- For DOM APIs unavailable in service workers (e.g., `DOMParser`, clipboard read), use `chrome.offscreen` documents.
- Offscreen documents are short-lived — create them per-task rather than keeping them alive.

### Host Permissions
- Use `host_permissions` in `manifest.json` (not `permissions`) for website access.
- Request only the minimum host permissions needed. Use `activeTab` as the default when possible.

---

## 4. Project Utils Architecture

This repository follows a shared-utils pattern. Each extension's `utils/` directory should contain:

| File | Responsibility | APIs Allowed |
|-|-|-|
| `storage-manager.js` | All `chrome.storage` reads/writes, data migration, caching | `chrome.storage.*` |
| `logger.js` | Structured logging, error tracking | Console, optional remote logging |
| (extension-specific) | One file per domain concern | Varies |

**Guidelines:**
- `storage-manager.js` should be the ONLY file that calls `chrome.storage.*` directly.
- Utility functions must be pure or have their side effects clearly documented in the function name.
- Each utility file should export named functions, not a single class or object.

---

## 5. Chrome Extension Assets

**CRITICAL:** Every Chrome extension MUST have a unique, independent set of assets.

**Icon Independence (MANDATORY):**
- Each extension's icons MUST be original and exclusive to that extension.
- Reusing or copying icons from another extension in this repository is strictly forbidden.
- If no icon is provided, one MUST be generated independently before shipping.

**Resource Purification (MANDATORY):**
- All generation scripts, intermediate files, and tooling used to produce assets MUST be removed immediately after final assets are created.
- Only production-ready image files may remain in the extension directory.

---

## 6. Documentation Standards

**CRITICAL:** Every project MUST maintain all four documentation files. Language rules are non-negotiable.

| File | Language | Purpose |
|-|-|-|
| `SPEC.md` | Traditional Chinese (繁體中文) | Product specification: features, acceptance criteria, roadmap |
| `README.md` | Traditional Chinese (繁體中文) | User manual: install, configure, operate |
| `ARCHITECTURE.md` | English | Developer guide: code structure, design decisions, onboarding |
| `CHANGELOG.md` | English | Change log: all notable changes per version |

**Planning — MANDATORY:** All plans, task breakdowns, and implementation directives MUST be written in English.

**CHANGELOG bootstrap rule:** If creating `CHANGELOG.md` for the first time, draft it based on `git diff` against the previous commit.

---

## 7. Anti-Patterns Registry

These are common mistakes observed in this project. Review your code for each:

| Anti-Pattern | Why It's Harmful | Fix |
|-|-|-|
| `chrome.storage` in content scripts | Creates tight coupling; breaks if API access changes | Message background script for settings |
| Module-level side effects (`init()` at top level) | Race conditions; unpredictable test behavior | Export init, let caller invoke |
| `console.log` for error reporting | Silent in production; no structured data | `throw new Error()` with descriptive message |
| Mixed concerns in one handler function | Untestable; violates SRP | Split into utils (data) + view (UI) |
| Hardcoded message type strings | Brittle; typo = silent failure | Define constants in a shared module |
| `let` at module scope for mutable state | Race conditions across re-injection | Use `chrome.storage` or pass as parameters |
| All component styles in one CSS file | 800 + lines; cross-component edits create regression risk | Split at component boundaries — one file per self-contained component |
| All popup logic in one JS file | Violates SRP; every change touches unrelated code | One file per concern; respect the 500-line limit |

---

## 8. File Size & Modularity

**Why it matters:** Files that grow beyond a few hundred lines signal that two or more distinct concerns have been packed together. The right moment to split is when a self-contained component or concern *first appears* — not after the file is already a monolith. Retrofitting a split is always more expensive than doing it upfront.

### Hard Thresholds

| File Type | Proactive-Split Threshold | Absolute Maximum |
|-|-|-|
| CSS | 350 lines | 500 lines |
| JS | 450 lines | 600 lines |

When any file reaches its **Proactive-Split Threshold** during a code change, you MUST flag it and propose a split plan before adding more code. Do NOT defer — the longer you wait, the more expensive the split becomes.

### When to Split (Pre-emptive Rules)

Propose a split when ANY of the following is true, regardless of current line count:

1. A file contains two or more visually or functionally distinct components (e.g., a modal AND a dropdown in the same CSS file).
2. You are about to add a new self-contained feature or component that could live in its own file from birth.
3. The file has crossed the Proactive-Split Threshold.

### How to Identify Split Boundaries

Good boundaries always correspond to a **single named component or concern**:

**CSS — each file owns one of:**
- Global foundation (CSS variables, reset, typography) → keep in the entry-point file (e.g., `popup.css`)
- A named UI component → `popup-select.css`, `popup-modal.css`
- A named layout region → `popup-sidebar.css`

**JS — each file owns one of:**
- A named manager or service → `storage-manager.js`, `messaging.js`
- A named UI component or controller → `editor.js`, `select-controller.js`
- A single domain concern → `prompt-formatter.js`, `rate-limiter.js`

If you cannot name the concern in two words, the boundary is wrong — keep looking.

### Naming Convention

```
CSS:  {entry-point}-{component}.css    →  popup-select.css, popup-modal.css
JS:   {concern}-{noun}.js              →  storage-manager.js, messaging.js
      {component}-controller.js        →  editor-controller.js
```

### Example: CSS Component Split

```
❌ BEFORE — popup.css (832 lines)
    Contains: base styles + preset selector + custom dropdown + modal

✅ AFTER — split at component boundaries
    popup.css          (~390 lines)  base styles, layout, controls, sliders, toast
    popup-select.css   (~190 lines)  .ds-select__* component
    popup-modal.css    (~105 lines)  .modal-* component
```

### Checklist Before Adding to Any Large File

- [ ] Is the new code a self-contained component or concern? → Create a new file.
- [ ] Will this addition push the file past 350 lines (CSS) or 450 lines (JS)? → Propose a split first.
- [ ] Does the file already contain multiple unrelated concerns? → Refactor before adding.
