---
name: spec-file-line-endings
description: Existing spec files in this repo use CRLF line endings — scripted string edits must account for \r\n
metadata:
  type: project
---

Existing `test/unit/*.spec.js` files (at least storage-manager.migration-push.spec.js)
use CRLF (`\r\n`) line endings, not LF. When programmatically patching a spec file
(e.g. via a Node script doing string replace instead of the Edit tool), an anchor
string built with plain `\n` will silently fail to match and the edit will be a
no-op with no error — only a script-level guard (checking occurrence count before
writing) will catch it.

Why: this environment had no Edit/Write tool available in a 2026-08-16 session, so
edits went through Bash + Node string-replace scripts; the first two attempts
failed silently on the CRLF mismatch.

How to apply: when this environment lacks Edit/Write and a scripted patch is
necessary, always read the target file's raw bytes/JSON.stringify a slice first to
check for `\r\n` before building anchor strings — do not assume LF. Also avoid
unicode punctuation (em dash, section sign §) inside JS backtick template literals
passed through `bash -c "node -e ..."`; use a heredoc (`cat > file << 'EOF'`) with a
quoted delimiter instead so bash does not attempt interpolation/escaping on it.
