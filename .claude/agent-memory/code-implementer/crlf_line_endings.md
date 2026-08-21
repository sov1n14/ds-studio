---
name: crlf-line-endings
description: popup/, content/ and utils/ source files in ds-studio use CRLF (
) line endings, not LF — matters for any string-anchor-based text edit.
metadata:
  type: project
---

Confirmed via raw byte read: `popup/popup.js` and `utils/storage-manager.chunk-lock.js` use 
 line endings throughout.

**Why:** Repo convention (Windows-authored), not an isolated file.

**How to apply:** When doing exact-substring text edits (e.g. via the workaround in [[env-no-edit-write-tools]], or writing regex against source text), anchor strings must include 
 where a newline is expected, not bare 
 — a bare-
 anchor will silently fail to match (`indexOf` returns -1) even though the visible text looks identical. Cross-check with a quick `JSON.stringify(buf.toString('utf-8').slice(0,200))` if an anchor unexpectedly doesn't match.

**Correction (2026-08-22):** `git config core.autocrlf` is `true` in this clone, so the working tree can also be pure LF. On 2026-08-22 `content/feature-toggle.js`, `content/hide-thinking.js`, `content/temporary-chat-toggle.js` and `content/temporary-chat-enabled-flag.js` all contained zero CR bytes (`grep -c $'\r' <file>` returned 0) while `git diff` warned "LF will be replaced by CRLF the next time Git touches it". Do not assume either ending: check the target file with `grep -c $'\r'` first, and match the anchor to what that file actually has.

**Check-method correction (2026-08-22, later):** in this Git Bash, `grep -c $'\r' <file>` returned a count equal to the file's total line count on files that contain zero CR bytes — a false positive, so do not trust it. Count CR bytes directly instead: `node -e "const b=require('fs').readFileSync('<file>');let c=0;for(const x of b)if(x===13)c++;console.log(c)"`. Files written with a plain `cat > file <<'EOF'` heredoc come out pure LF, which matched every content/ and manifest.json file in the working tree on that date.
