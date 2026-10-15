---
name: file-edits-crlf
description: Test file line endings are mixed per file (CRLF and LF coexist); detect EOL per file in node before scripted edits, never trust Git Bash grep for it
metadata:
  type: feedback
---

Line endings in test/unit/*.spec.js are mixed per file. As of 2026-10-16 sidebar-auto-hide.spec.js is CRLF while ds-selectors.spec.js and auto-open-sidebar.spec.js are LF. In Git Bash, `grep -c $'$' file` reported every line of an LF file as CRLF, so it is not a valid detector. `sed -i` under Git Bash has also rewritten a whole CRLF file to LF.

**Why:** 2026-09-26 a multi-line replace missed silently and sed produced a full-file line-ending diff; 2026-10-16 the grep check claimed LF files were CRLF and a CRLF-joined anchor matched nothing.

**How to apply:** when only Bash is available for edits (Edit/Write absent in subagent sessions), use a node script that detects EOL per file (`s.includes('
')`), joins multi-line anchors and replacements with that EOL, asserts exactly one match before writing, and prints CRLF vs LF counts afterwards. Never chain `python - <<EOF || node ...` (heredoc swallows the rest).
