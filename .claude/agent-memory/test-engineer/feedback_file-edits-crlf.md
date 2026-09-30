---
name: file-edits-crlf
description: Working-copy test files are CRLF; Git Bash sed -i silently converts them to LF — edit via node with CRLF normalization
metadata:
  type: feedback
---

Test files in the working copy use CRLF (repo stores LF, autocrlf). Multi-line string matches in node scripts fail unless the content is normalized first, and `sed -i` under Git Bash rewrote a whole file to LF.

**Why:** 2026-09-26 stop-button task: a multi-line replace missed silently, and sed produced a full-file line-ending diff that had to be repaired.

**How to apply:** when only Bash is available for edits, use `node -` with a quoted heredoc: read, `.replace(/\r\n/g,'\n')`, edit, write back with `\r\n`. Never chain `python - <<EOF || node ...` (heredoc swallows the rest). Confirm with `git diff --stat` that only intended lines changed.
