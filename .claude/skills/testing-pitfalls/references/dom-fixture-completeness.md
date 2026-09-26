# DOM Fixture Completeness

**Lesson from**: v4.33.18 → v4.33.26 — `findSendButtonForTextarea` regression. `querySelector` returns the first DOM-order match. The attachment button matched the same selector as the send button and appeared first in the real DOM. Tests passed because the fixture only contained the send button — no attachment button to expose the ordering conflict.

**Rule**: Test fixtures for a UI region MUST include all interactive sibling elements present in the real page, not just the element under test. When code uses `querySelector` or any first-match API, omitting siblings that match the same selector hides ordering-dependent bugs.

**Check**: Before finalizing a DOM fixture, compare against real page structure (`to-do/samples/` for HTML snapshots). Every element matching the selector under test must appear in the fixture, in real DOM order.
