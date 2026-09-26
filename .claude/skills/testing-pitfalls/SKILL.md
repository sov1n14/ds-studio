---
name: testing-pitfalls
description: Read before writing, editing, or reviewing any test in this project — unit test, spec, fixture, DOM mock, `chrome.storage` test double — every time, before starting. Also when fixing a confirmed bug the existing tests missed — they passed while it shipped, asserted a tautology, or a fixture or mock masked it — to record the lesson. Not for test methodology (verification-testing-policy) or code design (coding-principles).
---

# Testing Pitfalls

Lessons from real bugs that shipped under green tests. Consulting them before each test keeps the project from repeating a failure it already paid for.

## How to Use

1. **Glance** — before writing, editing, or reviewing any test, read the index below.
2. **Match** — judge whether any entry is strongly related to the test at hand.
3. **Open** — for each match, read its reference file and apply its Prevention and Check to the test.

## Index

| Pitfall | Relevant when your test … | Reference |
|-|-|-|
| DOM Fixture Completeness | builds a DOM fixture for code using `querySelector` or any first-match API, where sibling elements could match the same selector, or tests a tolerant or fallback matcher that another element could satisfy in a different UI state | [dom-fixture-completeness.md](references/dom-fixture-completeness.md) |
| Boundary Test Doubles Must Copy | fakes `chrome.storage`, messaging, IndexedDB, or any in-memory store, or asserts a read-modify-write / lost-update outcome, or simulates a boundary error such as `chrome.runtime.lastError` or a `sendMessage` failure (including a resolved `undefined`) | [boundary-doubles-must-copy.md](references/boundary-doubles-must-copy.md) |
| Red For the Right Reason | fails because its target is not implemented yet, or loads its target through a runtime `import()`, `require`, or other dynamic loader | [red-for-the-right-reason.md](references/red-for-the-right-reason.md) |
| Layout Measurement Needs a Layout Model | exercises code that reads `scrollWidth`, `offsetWidth`, `clientWidth`, or `getBoundingClientRect`, or writes a measured size back into the element it measures | [layout-measurement-needs-layout-model.md](references/layout-measurement-needs-layout-model.md) |
| Overlapping Async Writes: Older Resolves Last | exercises state written by more than one in-flight async call, such as an optimistic update followed by a rollback | [overlapping-async-writes.md](references/overlapping-async-writes.md) |
| Zero Is Not Missing: Fallback Inputs | exercises code that substitutes a default when a parsed or read value is missing, such as a computed-style number where 0 is a legitimate value | [zero-is-not-missing.md](references/zero-is-not-missing.md) |
| Host-Page Controls: Assert Activation, Not Dispatch | asserts that the extension clicked or triggered a host-page button or control, or builds a fixture for a page element whose handler (React `onClick`, `isTrusted` guard) decides whether to act | [assert-activation-not-dispatch.md](references/assert-activation-not-dispatch.md) |

## Adding a New Lesson

Record a lesson in the same change as a bug fix that meets both conditions:

1. **Real bug** — the defect is confirmed: reproduced or observed on pre-fix code, not hypothesized.
2. **Missed by existing tests** — the suite stayed green on pre-fix code: tests passed while the bug shipped, asserted a tautology, or a fixture or mock masked the defect.

Each lesson file holds these paragraphs, each opening with its bold label:

| Field | Records |
|-|-|
| **Cause** | the bug (version or function), why it existed, and why the existing tests missed it |
| **Solution** | the fix, plus the test that now catches the bug and its observed red on pre-fix code |
| **Prevention** | the rule every future test author MUST follow to avoid the same blind spot |
| **Check** | the concrete step that verifies the Prevention rule before trusting a test |

Steps:

1. Search the index for an entry covering the same test blind spot.
2. Match: append a **Cause** and a **Solution** paragraph for the new bug to that file, widen its **Prevention** and **Check** to cover the new case, and widen its index trigger if needed.
3. No match: create `references/<kebab-case-name>.md` with an H1 title and the four paragraphs, then add one index row — pitfall name, a one-clause "relevant when your test …" trigger, and a relative link to the new file.
