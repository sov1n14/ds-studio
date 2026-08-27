---
name: chrome-extension-coding-guidelines
description: Read before writing, reviewing, or refactoring any code in this extension — popup/, content/, background/ service worker, utils/, manifest.json — and again before declaring the change complete. Triggers - chrome.storage or sendMessage usage, MutationObserver wiring, adding a new file, any source file past 250 lines (justification required) or approaching the 450-line hard limit, PR review. Not for version numbering — use the version-bump skill.
---

## 0. How to Read This File

**Normative keywords:** `MUST` / `MUST NOT` — a violation blocks the change. `SHOULD` — deviation is allowed only with the reason stated in the commit or PR description. `MAY` — free choice.

**Precedence when documents disagree:** the user's instruction in their current message > `CLAUDE.md` > this file > general convention. Never resolve a conflict by guessing; the higher source wins and the lower one gets corrected.

**Scope:** this file covers only what is specific to this Chrome extension. General design principles — SRP, DRY, KISS, YAGNI, intent-revealing naming, composition over inheritance, fail-fast validation, testability — live in the `coding-principles` skill; read that one too, and do not expect its content to be repeated here.

**Scope of enforcement:** these rules bind the code you add or modify in the current change. Pre-existing violations are catalogued under `to-do/` and MUST NOT be refactored en masse without an explicit request — an unrequested twenty-file refactor is unreviewable and unrelated to the task at hand. When you touch a file that already violates a rule, bring that file into compliance and leave its siblings alone.

**Enforcement mechanism:** conformance to the rules *in this file* — layer boundaries, naming, file size — is checked by human or agent review, with one mechanical exception: `test/unit/storage-manager.loader-contract.spec.js` enforces the load-order contract described in §1.

**This says nothing about testing the code's behavior**, which is a separate obligation and is not optional. `CLAUDE.md` §2 governs it: logic-layer changes follow the red-green protocol — `test-engineer` writes the failing test and reports the observed failure before any implementation exists, `code-implementer` implements without touching the test files, `test-executor` certifies the pass. DOM-adapter changes explore the live page first, then implement, then add tests. Unit tests only, all of them under `test/`. Satisfying the review rules here does not discharge that; passing tests does not discharge these.

---

## 1. Layers & Runtime Model

**Why it matters:** each layer runs in a different execution context with different API access. Code that reaches across a layer boundary cannot be unit-tested without mocking a context it should never have known about, and it breaks when Chrome changes its isolation model.

| Layer | Owns | MUST NOT |
|-|-|-|
| `popup/` | Rendering, user input, calling `utils/` | Call `chrome.*` directly; hold business logic |
| `background/` | Service-worker lifecycle, cross-tab coordination, alarms, message routing | Touch the DOM |
| `content/` | DOM reading and injection on `chat.deepseek.com`, DeepSeek selectors, `MutationObserver` wiring | Call `chrome.storage.*`, `chrome.alarms.*`, or any other service-worker-only API |
| `utils/` | Reusable logic — storage, i18n, messaging, formatting, validation | Reference the DOM; contain layer-specific branching |

**Layer access rules:**

- `popup/` MUST reach every extension API through a `utils/` module: storage through `utils/storage-manager.js`, tab/messaging coordination through `utils/tab-control.js`, and any window or tab control through a `utils/` wrapper named after that concern. Rationale: a popup with no `chrome.*` call is unit-testable without a `chrome` mock.
- `content/` MUST obtain settings by messaging `background/`, which owns storage access on its behalf.
- `utils/` MUST stay loadable by any layer, which means it MUST NOT assume a `document` exists.

**Runtime model (MV3, classic scripts):**

- The extension loads classic scripts in the order declared by `manifest.json`, `popup/popup.html`, `popup/editor/editor.html`, and `background/service-worker.js`. `import` / `export` MUST NOT be used.
- A file publishes its API by attaching to a global — `window.DSstudio.<Concern>`, or the module's own established global such as `StorageManager`. Match the global already used by the file you are editing.
- A multi-file module (the `utils/storage-manager.*.js` bundle) mixes its parts into the entry file's global. Every part MUST be loaded before the entry file in every loader. `test/unit/storage-manager.loader-contract.spec.js` fails when a new part is added without wiring it into all five loaders — add the part to the loaders in the same change.
- Service workers terminate at any time. Persistent state MUST live in `chrome.storage`, and every listener and alarm MUST be registered at the top level of the service worker so it survives termination.

---

## 2. Extension-Specific Code Rules

**No module-level side effects.** A file MUST NOT run work at load time; it exports an init function and the caller invokes it. Rationale: content scripts re-run on SPA navigation and re-injection, so load-time work double-fires and races itself. For the same reason, module-scope `let` MUST NOT hold mutable state that must survive re-injection — put it in `chrome.storage` or pass it as a parameter.

**Boolean naming.** Boolean variables and functions MUST carry an `is` / `has` / `can` prefix — `isEnabled`, `hasPermission`, `canRetry`.

**DeepSeek selectors belong in `content/ds-selectors.js`.** A selector that targets DeepSeek's own markup MUST be declared there and read from there, never inlined at a `querySelector` call site. Rationale: DeepSeek ships new class names without notice, and a scattered selector turns one upstream change into a repo-wide hunt. A selector for markup this extension itself injected MAY stay local to the injecting file.

**Message types and storage keys are named constants.** Every `chrome.runtime` / `chrome.tabs` message `type` string and every storage key MUST come from a constant, declared in a `*-constants.js` file co-located with the feature; when the constants are read by more than one layer (content plus service worker or popup), the file lives in `utils/` — the pattern set by `utils/temporary-chat-constants.js`. A typo in a literal string fails silently; a typo in a constant name throws.

**Error reporting.** Pick by who can act on the failure:

| Situation | Mechanism |
|-|-|
| Broken invariant or missing dependency the caller cannot recover from | `throw new Error()` whose message names the missing thing and the fix, as `content/harvest.js` does for its load-order dependency |
| Failure at a boundary nothing can catch — `chrome.runtime.onMessage` handler, `MutationObserver` callback, DOM event listener, timer callback | Catch it and `console.error('[DSS] <context>:', err)` |
| Recoverable degradation where the feature continues | `__DS_Logger.warn` from `utils/logger.js`, or `console.warn` with the `[DSS]` prefix |

`console.log` is a debugging tool only and MUST be removed before the change is committed.

**CSS isolation.** Injected styles MUST use a project class prefix (`ds-`) so they cannot leak into the host page.

**Permissions.** Website access goes in `host_permissions`, kept to the minimum the feature needs.

---

## 3. File Size & Modularity

**Why it matters:** a file past a couple hundred lines has usually absorbed a second concern. The cheap moment to split is when that concern *first appears*; retrofitting a split later costs far more.

Three bands, applying to every source file, JS and CSS alike:

| Lines | Status |
|-|-|
| Up to 250 | The target state. No justification needed. |
| 250 to 450 | Tolerated, and the reason MUST be stated in the commit or PR description. "This is one cohesive component and every boundary I found was artificial" is a reason; "it grew" is not. |
| Over 450 | MUST NOT ship. Split it as part of the change that would have pushed it over. |

The bands describe where a file may sit, not a budget to spend. A file already inside the tolerance band SHOULD be moved back toward 250 by the next change that touches it, not held at its current size until it hits 450.

Propose a split — before adding the new code, not after — when any of these holds: the addition would push the file past 250 lines and you cannot state why it belongs in one file, the file already holds two functionally distinct components, or the code you are about to add is a self-contained component that could live in its own file from birth.

A good boundary owns exactly one named component or concern: a global CSS foundation, one named UI component, one named layout region, one manager or service, one domain concern. If the concern cannot be named in two words, the boundary is wrong.

**Naming convention:**

```
CSS:  {entry-point}-{component}.css    popup-select.css, popup-modal.css
JS:   {concern}-{noun}.js              storage-manager.js, messaging.js
      {component}-controller.js        editor-controller.js
      {feature}-constants.js           temporary-chat-constants.js
```

A multi-part module extends its entry file's name with a dot segment: `storage-manager.sync.js`, `storage-manager.presets.js`. See §1 for the loading contract such a split creates.

---

## 4. Documentation & Assets

| File | Language | Purpose |
|-|-|-|
| `SPEC.md` | 繁體中文 | Product specification: features, acceptance criteria, roadmap |
| `README.md` | 繁體中文 | User manual: install, configure, operate |
| `ARCHITECTURE.md` | English | Developer guide: code structure, design decisions, onboarding |
| `docs/CHANGELOG.md` | English | Version-summary table linking into `docs/changelog/v<major>.md`, which holds the per-line entries |

Plans, task breakdowns, and directives to subagents MUST be written in English. UI copy is localized through `_locales/` and `utils/i18n.js`, never hardcoded in a view file.

Extension icons MUST be original to this extension. Scripts and intermediate files used to generate an asset MUST be deleted once the production asset exists, leaving only the shipped image files.
