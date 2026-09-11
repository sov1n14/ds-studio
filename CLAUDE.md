# Project Standards

## Platform

Open-source MV3 Chrome Extension for DeepSeek web (`https://chat.deepseek.com/`, inferred React). **MUST** read `chrome-extension-coding-guidelines` skill before any code work and before declaring complete — it owns MV3 rules, layer separation, file-size limits (250-line justification, 450-line hard split per section 3).

## Layered TDD

DOM-adapter behavior is defined by the live page (selectors, React timing, class names), so test-first there encodes the same guess twice.

| Layer | Examples | TDD |
|-|-|-|
| Logic | State, settings, toggles, retry/timing, parsing, storage schema, pure helpers | **MUST** red-green: failing test first, then implement |
| DOM-adapter | Selectors, `MutationObserver`, injection timing, event binding | Implement first, then add tests |

**MUST**: every bug fix requires a test observed failing on pre-fix code before the fix lands.

## Anti-Tautology

Project-wide. Assertions written by reading the implementation are invalid. Assert observable behavior and return values, not internal call sequences. This project shipped a real defect under 1,000+ green tests because every assertion was transcribed from the implementation. Mutation testing (Stryker) enforces this — a survived mutant is code that can change without any test noticing.

## Testing Policy

- **MUST** unit tests only; integration/e2e (Playwright) **MUST NOT** return.
- Every code change **MUST** land with new or updated unit tests; remove obsolete cases.
- **ALL** test files (tests, fixtures, helpers, mocks) live under `test/` only.
- Run scoped tests by default; full suite only when explicitly requested.

### Scenario Unit Tests

Cross-module mutable state requires at least one scenario test. Single-module state and pure functions need only isolated unit tests.

**Trigger** (any one requires a scenario test):

| Condition | Description |
|-|-|
| Cross-module mutable state | Module A sets state, module B reads it to decide |
| Partial failure path | Function partially succeeds then fails, causing inconsistent state |
| Cross-module flag lifecycle | Flag whose set and reset belong to different modules |
| Destructive + constructive in one event | Same event deletes and creates/tracks |

**Scenario rules**:

- Mock only trust boundaries (`chrome.runtime`, `fetch`, external APIs); **MUST NOT** mock inter-module boundaries
- Real module instances sharing a real state object
- One scenario per trust-boundary failure mode: success, promise rejection, synchronous throw, timeout
- Assert observable end-state, not internal call sequences

## Versioning, Commits, and Docs

- Behavior-affecting changes **MUST** bump `manifest.json` version per `version-bump` skill.
- Commits follow `commit-standards` skill.
- `docs/` **MUST** stay synchronized after any code or feature change.
