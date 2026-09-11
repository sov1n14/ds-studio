# Project Standards

## Platform

Open-source Chrome Extension (Manifest V3) optimizing conversation features of DeepSeek web at `https://chat.deepseek.com/`. Target page is inferred React. **MUST** read the `chrome-extension-coding-guidelines` skill before any code work and again before declaring code complete — it owns MV3 rules, layer separation, and file-size limits (250-line justification threshold, 450-line hard split per its section 3).

## Layered TDD

TDD applies by layer. DOM-adapter behavior is defined by the live DeepSeek page (selectors, React re-render timing, class names), so writing tests first there encodes the same guess twice.

| Layer | Scope examples | TDD |
|-|-|-|
| Logic | State and settings, toggle/branch decisions, retry and timing logic, message parsing, storage schema, pure helpers | **MUST** red-green: write the failing test, observe the failure, then implement |
| DOM-adapter | Selectors, `MutationObserver` wiring, injection timing, event binding to page elements | Explore, implement, then add tests |

**MUST**: every bug fix requires a test observed failing on the pre-fix code before the fix lands.

## Anti-Tautology Rules

Apply project-wide, both layers. A test whose assertions were written by reading the implementation is invalid regardless of pass/fail. Assert observable behavior and return values, not internal call sequences — mocking a collaborator and asserting it was called proves nothing about correctness. This project shipped a real logic defect under more than 1,000 green tests that had never failed once because every assertion was transcribed from the implementation. Mutation testing (Stryker) is the deterministic enforcement of this rule — a survived mutant is code that can change without any test noticing, directly exposing the tautology risk.

## Testing Policy

- **MUST** use unit tests exclusively; integration and e2e tests (Playwright) are retired and **MUST NOT** return.
- Every code change **MUST** land with new or updated unit tests; remove obsolete cases.
- **ALL** test-related files (tests, fixtures, helpers, mocks) live under `test/` only.
- Run scoped tests by default; run the full suite only when the user explicitly requests it — full runs are slow.

## Versioning, Commits, and Docs

- Behavior-affecting code changes **MUST** include a `manifest.json` version bump per the `version-bump` skill.
- Commits follow the `commit-standards` skill.
- `docs/` **MUST** stay synchronized with the product after any code or feature change.
