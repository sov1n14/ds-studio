---
name: bash-tool-quoting
description: Bash tool heredoc breaks when the command body contains backticks; use sed + plain heredoc appends instead
metadata:
  type: project
---

In this environment, a Bash-tool command whose heredoc body contains backtick characters fails with "unexpected EOF while looking for matching quote" (the wrapper mangles command substitution before bash parses). Plain single quotes inside heredoc bodies are fine.

**Why:** The Bash tool wraps commands in a way that breaks on backticks; hit this while scripting an editor.spec.js edit via `node <<'NODEEOF'`.

**How to apply:** When writing test files without the Edit/Write tools (only Read/Glob/Grep/Bash available in subagent context), avoid backticks in heredoc bodies — build JS content as a plain string with escaped newlines, or use sed for single-line edits plus `cat >> file <<'EOF'` for appends. Also note: multi-line heredocs DO work in this environment (tested), as long as the body is backtick-free.

Second failure mode (hit 2026-08-08 on harvest.spec.js): the same "unexpected EOF while looking for matching quote" error appears when the TOTAL command payload exceeds roughly 8-9 KB, even with zero backticks — the wrapper truncates the command mid-content. Fix: split the edit into several smaller scripts (~2-3 KB each). A "27 KB" probe passed only because the bytes were generated at runtime; what matters is the byte size of the command text itself.
