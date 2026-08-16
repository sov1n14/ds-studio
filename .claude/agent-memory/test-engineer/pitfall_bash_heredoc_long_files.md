---
name: pitfall-bash-heredoc-long-files
description: Writing a long spec file (~150+ lines) via a single Bash `cat > file << 'EOF'` heredoc silently breaks with "unexpected EOF while looking for matching \`''" even though the content has no unescaped quotes
metadata:
  type: feedback
---

A single Bash tool call using `cat > path << 'EOF' ... EOF` to write a JS/TS
spec file fails with `unexpected EOF while looking for matching \`''` once the
heredoc content grows to roughly 150-200+ lines, even when every quote in the
content is properly paired and the delimiter itself is untouched. This is not
a quoting bug in the content - reproduced repeatedly with a fixed set of
apostrophes/double-quotes that worked fine in shorter chunks.

**Why:** Root cause not fully isolated (looks like a limit in how this
environment's Bash tool serializes/passes very long multi-line commands), but
it is reliably reproducible: the exact same content split into ~4-6 smaller
`cat >>` append calls (each under ~100 lines) always succeeds, while one giant
single-shot heredoc with the same total content fails.

**How to apply:** When authoring a new spec file of non-trivial size, write it
in chunks: one `cat > file << 'EOF' ... EOF` for the first chunk (header +
imports), then several `cat >> file << 'EOF' ... EOF` calls to append the rest
in ~50-100 line pieces. Verify with `wc -l` after each append. If a `describe`
block needs to span two chunks, either keep it whole within one chunk, or
append the closing `});` in a later chunk and fix any premature closing brace
via `head -n <N> file > tmp && mv tmp file` before continuing. Read the file
back in full afterward to confirm structural correctness before running tests.
