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

### Scenario Unit Tests

當 mutable state 跨越 module 邊界時，isolated unit tests 不足以驗證正確性——**MUST** 至少補一個 scenario test 覆蓋跨 module 的 state flow。單一 module 內的 state 及 pure functions 仍僅需 isolated unit tests。

**觸發條件**（符合任一即需要 scenario test）：

| 條件 | 說明 |
|-|-|
| 跨 module mutable state | Module A 設定 state，module B 讀取該 state 做決策 |
| Partial failure path | 函式可能部分成功後失敗，導致 state 不一致 |
| 跨 module flag 生命週期 | 某 flag/state 的 set 與 reset 分屬不同 module |
| 單一事件觸發破壞與建構操作 | 同一 event 同時執行 destructive（delete）與 constructive（create/track）操作 |

**Scenario 定義方式**：

- Mock 僅限 trust boundary（`chrome.runtime`、`fetch`、外部 API），**MUST NOT** mock module 之間的邊界
- 使用真實 module 實例共用真實 state object
- Trust boundary 的每種失敗模式各一個 scenario：success、promise rejection、synchronous throw、timeout
- Assert observable end-state（刪除數量、最終 state 值），不 assert internal call sequences（哪些函式被呼叫）

## Versioning, Commits, and Docs

- Behavior-affecting code changes **MUST** include a `manifest.json` version bump per the `version-bump` skill.
- Commits follow the `commit-standards` skill.
- `docs/` **MUST** stay synchronized with the product after any code or feature change.
