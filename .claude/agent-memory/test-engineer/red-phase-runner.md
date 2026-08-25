---
name: red-phase-runner
description: A brand-new spec for a not-yet-existing content/*.js yields a collection-level red (import resolve error) and zero executed tests — hand the orchestrator the expected test count with it
metadata:
  type: project
---

Red phase for a module that does not exist yet: the side-effect `import '../../content/x.js'` fails at transform time with `Failed to resolve import "..." Does the file exist?`, so the suite file fails and NO test case executes.

**Why:** the extension ships classic scripts publishing `globalThis.X`, so specs import for the side effect and read the global back (pattern of `test/unit/settings-message-constants.spec.js`). A module-not-found red therefore proves the module is absent but says nothing about whether each assertion is discriminative — the exact hole the anti-tautology rules care about.

**How to apply:** report the resolve error verbatim AND the expected runtime test count per spec, so the certifying `test-executor` run can be checked for "N passed" instead of "no tests". For per-test module state in such specs, swap in a local `chrome.runtime.onMessage` stub and re-import the module under `vi.resetModules()` in `beforeEach`. Run command in [[vitest-invocation]]; for the case where the fix already landed see [[red-phase-probe-vs-head]].
