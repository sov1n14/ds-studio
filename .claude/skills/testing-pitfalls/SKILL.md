---
name: testing-pitfalls
description: Read before writing, editing, or reviewing any test in this project — unit test, spec, fixture, DOM mock, `chrome.storage` test double — every time, before starting. Also when recording a new lesson after a test failed its purpose - passed while a bug shipped, tautological, or masked by a fixture or mock. Not for test methodology (verification-testing-policy) or code design (coding-principles).
---

# Testing Pitfalls

Lessons from real bugs that shipped under green tests. Consulting them before each test keeps the project from repeating a failure it already paid for.

## How to Use

1. **Glance** — before writing, editing, or reviewing any test, read the index below.
2. **Match** — judge whether any entry is strongly related to the test at hand.
3. **Open** — for each match, read its reference file and apply its Rule and Check to the test.

## Index

| Pitfall | Relevant when your test … | Reference |
|-|-|-|
| DOM Fixture Completeness | builds a DOM fixture for code using `querySelector` or any first-match API, where sibling elements could match the same selector | [dom-fixture-completeness.md](references/dom-fixture-completeness.md) |
| Boundary Test Doubles Must Copy | fakes `chrome.storage`, messaging, IndexedDB, or any in-memory store, or asserts a read-modify-write / lost-update outcome, or simulates a boundary error such as `chrome.runtime.lastError` | [boundary-doubles-must-copy.md](references/boundary-doubles-must-copy.md) |
| Red For the Right Reason | fails because its target is not implemented yet, or loads its target through a runtime `import()`, `require`, or other dynamic loader | [red-for-the-right-reason.md](references/red-for-the-right-reason.md) |

## Adding a New Lesson

Record a lesson when a test failed its purpose — it passed while a bug shipped, asserted a tautology, or a fixture or mock masked the defect.

1. Create `references/<kebab-case-name>.md` with an H1 title and three paragraphs: **Lesson from** (the bug, the version or function, why the tests missed it), **Rule** (what every future test MUST do), **Check** (the concrete step that verifies the rule before trusting the test).
2. Add one row to the index: pitfall name, a one-clause "relevant when your test …" trigger, and a relative link to the new file.
