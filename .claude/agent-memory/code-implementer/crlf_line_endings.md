---
name: crlf-line-endings
description: popup/*.js (and likely other JS) source files in ds-studio use CRLF (
) line endings, not LF — matters for any string-anchor-based text edit.
metadata:
  type: project
---

Confirmed via raw byte read: `popup/popup.js` uses 
 line endings throughout.

**Why:** Repo convention (Windows-authored), not an isolated file.

**How to apply:** When doing exact-substring text edits (e.g. via the workaround in [[env-no-edit-write-tools]], or writing regex against source text), anchor strings must include 
 where a newline is expected, not bare 
 — a bare-
 anchor will silently fail to match (`indexOf` returns -1) even though the visible text looks identical. Cross-check with a quick `JSON.stringify(buf.toString('utf-8').slice(0,200))` if an anchor unexpectedly doesn't match.
