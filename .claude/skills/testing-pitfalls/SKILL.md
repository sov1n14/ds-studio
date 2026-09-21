---
name: testing-pitfalls
description: Read when writing or reviewing a test — especially DOM fixtures, mocks, and regression tests for bug fixes. Triggers - creating a test fixture or DOM mock, reviewing why a test suite passed while a bug shipped, adding sibling/neighboring elements to a test's DOM setup, writing a test for code that uses `querySelector` or any first-match DOM API. Not for test methodology (verification-testing-policy) or code design (coding-principles).
---

# Testing Pitfalls

Lessons from real bugs that shipped under green tests. Each entry records a failure pattern, why existing tests missed it, and the rule that prevents recurrence.

Review the checklist when writing or reviewing any test fixture.

## Checklist

### 1. DOM Fixture Completeness

**Lesson from**: v4.33.18 → v4.33.26 — `findSendButtonForTextarea` regression. `querySelector` returns the first DOM-order match. The attachment button matched the same selector as the send button and appeared first in the real DOM. Tests passed because the fixture only contained the send button — no attachment button to expose the ordering conflict.

**Rule**: Test fixtures for a UI region MUST include all interactive sibling elements present in the real page, not just the element under test. When code uses `querySelector` or any first-match API, omitting siblings that match the same selector hides ordering-dependent bugs.

**Check**: Before finalizing a DOM fixture, compare against real page structure (`to-do/samples/` for HTML snapshots). Every element matching the selector under test must appear in the fixture, in real DOM order.
