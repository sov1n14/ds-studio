---
name: reference-jsdom-per-file-env
description: jsdom 31 opts in per spec via a first-line docblock for structural :has() selectors; its gaps (innerText, scrollIntoView, location.pathname spy) and the stubs that work
metadata:
  type: reference
---

Specs asserting structural DeepSeek selectors (multi-level `:has(> a > b)`, scoped querySelector referencing ancestors outside the element) start with `// @vitest-environment jsdom` (jsdom ^31 devDependency in test/, added 2026-11-08); the global env stays happy-dom 16.

jsdom gaps met in G1 (2026-11-08):
- No `innerText`: define a textContent-backed getter on HTMLElement.prototype in beforeAll and remove it in afterAll (content-script.export.spec.js).
- `vi.spyOn(window.location, 'pathname', 'get')` throws "Cannot redefine property: pathname"; use `history.replaceState({}, '', path)` instead (test/helpers/set-pathname.js style) and reset in afterEach.
- No `scrollIntoView`; stub per spec when needed.
- `globalThis.DSstudio.Selectors` is the same unfrozen object modules captured, so a scratch copy of a spec can mutate one constant in beforeAll to prove a test catches a wrong selector, without a probe config.
- jsdom (nwsapi) auto-closes a bracket left open at end of input, so `querySelector('div:has(x')` does not throw; a selector-syntax invariant also needs a bracket-balance check (test/unit/ds-selectors.spec.js hasBalancedBrackets), because an unclosed :has( silently swallows any selector concatenated after it.

Related: [[happy-dom-has-descendant]], [[reference-ds-locator-probe-snapshots]].
