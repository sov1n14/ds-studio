---
name: project-temp-chat-constants-unwired
description: content/temporary-chat-constants.js is not actually imported by any consumer or test — every user re-declares the same literals independently
metadata:
  type: project
---

`content/temporary-chat-constants.js` exports 13 constants (`DSS_TEMP_CHAT_STORAGE_KEY`, `DSS_FIBER_DELETE_MESSAGE_TYPE`, etc.) meant as the "shared contract between modules." Grepping every production consumer that mentions it (`content/temporary-chat-toggle.js`, `content/temporary-chat-delete.js`, `content/temporary-chat-pending-store.js`, `content/censor-xhr-hook.js`, `background/service-worker.js`) shows NONE of them `import`/`require` the file — each re-declares its own copy of the same literal (e.g. `temporary-chat-toggle.js` does `_getConst('DSS_TEMP_CHAT_STORAGE_KEY', 'dss-temporary-chat-enabled')`, falling back to a hardcoded default; `service-worker.js` does `const SCHEDULE_DELETE_RETRY = 'DSS_SCHEDULE_DELETE_RETRY';` outright) with only a `// 同 constants` (same as constants) comment linking them by convention, not by code.

Same pattern on the test side: `test/unit/temporary-chat-toggle.spec.js`, `temporary-chat-delete.spec.js`, `temporary-chat-delete-api.spec.js`, `temporary-chat-pending-store.spec.js`, `censor-xhr-hook.*.spec.js`, `service-worker.pending-delete.spec.js` all hardcode the literal strings directly and never reference `temporary-chat-constants.js`. `test/unit/temporary-chat-constants.spec.js` is the ONLY file in the entire repo (production or test) that ever imports the module.

**Consequence for redundancy analysis** (see [[project_constant_mirror_redundancy_test]]): mutating any of the 13 constants in this file provably cannot cascade to any other test — there is zero import coupling. So by the redundancy rule, all 13 constant-mirror assertions in `temporary-chat-constants.spec.js` are the sole tripwire and must be KEPT (verdict: NO/redundant for none of them, decided 2026-07-25). The whole file survives unchanged.

**Separate, out-of-scope observation for whoever owns production code:** since nothing actually reads this module's exports, it currently functions as documentation with a test, not as a wired "single source of truth" — the `_getConst(name, fallback)` globalThis-lookup pattern in the consumers can likely never receive a non-fallback value in the browser either, because a top-level `const` in a classic (non-module) content script does not become a `window`/`globalThis` property. This is a potential dead-code/architecture question, not a test-authoring one — flag it to the orchestrator/code-implementer rather than acting on it, since `code-implementer` scope, not `test-engineer`.
