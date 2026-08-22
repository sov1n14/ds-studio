---
name: no-hard-wrap-hook
description: A write hook blocks files containing hard-wrapped comment paragraphs; keep each comment paragraph on one line when editing tests.
metadata:
  type: feedback
---

Writes are rejected with "Manual hard wrap detected (line N). FORBIDDEN: write each paragraph as one line." when a comment paragraph spans multiple lines. A standalone `//` comment immediately followed by a code line also tripped it, so either keep such a comment as a single self-contained line separated by a blank line, or drop it.

**Why:** Global rule "No manual hard wraps in files" is enforced by a hook at write time, so a rewrite of a pre-existing file that already contains a wrapped JSDoc block will fail until the block is unwrapped.

**How to apply:** When rewriting an existing test file wholesale, unwrap any multi-line JSDoc paragraph into one line first; expect the diff to include that unrelated-looking reflow.
