# Project Standards

## Platform

Open-source MV3 Chrome Extension for DeepSeek web (`https://chat.deepseek.com/`, inferred React). **MUST** read the `chrome-extension-coding-guidelines` skill before any code work and again before declaring it complete — the skill owns MV3 rules, layer separation, and file-size limits.

## Layered TDD

DOM-adapter behavior is defined by the live page (selectors, React timing, class names), so test-first there encodes the same guess twice.

| Layer | Examples | TDD |
|-|-|-|
| Logic | State, settings, toggles, retry/timing, parsing, storage schema, pure helpers | **MUST** red-green: failing test first, then implement |
| DOM-adapter | Selectors, `MutationObserver`, injection timing, event binding | Implement first, then add tests |

**MUST**: every bug fix, in either layer, starts with a test observed failing on pre-fix code — a reproduced bug is observed behavior, so the red test encodes a fact instead of a guess.

**MUST**: when the bug is confirmed real and existing tests missed it, the same change records a lesson (cause, solution, prevention) in the `testing-pitfalls` skill, following its entry format — so no future test repeats the same blind spot.

## Anti-Tautology

**CRITICAL**: assert observable behavior and return values, never internal call sequences or values transcribed from reading the implementation — this project shipped a real defect under 1,000+ green tests because every assertion mirrored the code. Stryker mutation testing enforces this: a survived mutant is code that can change without any test noticing.

## Testing Policy

- **MUST** write unit tests only — no integration or e2e (Playwright) tests.
- Every code change **MUST** land with new or updated unit tests, and delete cases the change made obsolete.
- **ALL** test files (tests, fixtures, helpers, mocks) live under `test/`.
- Run scoped tests by default; run the full suite only when explicitly requested.

### Scenario Unit Tests

Any trigger below requires at least one scenario test; single-module state and pure functions need only isolated unit tests.

| Trigger | Description |
|-|-|
| Cross-module mutable state | One module writes state or a flag that another module reads to decide, or resets |
| Partial failure path | A function partially succeeds then fails, leaving inconsistent state |
| Destructive + constructive in one event | The same event deletes and creates/tracks |

Scenario rules:

- Mock only trust boundaries (`chrome.runtime`, `fetch`, external APIs); **MUST NOT** mock inter-module boundaries — the defect lives in how real modules share state.
- Use real module instances sharing a real state object.
- Write one scenario per trust-boundary failure mode: success, promise rejection, synchronous throw, timeout.

## Versioning, Commits, and Docs

- Behavior-affecting changes **MUST** bump the `manifest.json` version per the `version-bump` skill.
- Commits follow the `commit-standards` skill.
- `docs/` **MUST** stay synchronized with every code or feature change.
