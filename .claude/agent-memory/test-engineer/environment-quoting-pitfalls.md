---
name: environment-quoting-pitfalls
description: Windows Git-Bash mangling of backslash sequences in Bash tool commands, and dead python stub
metadata:
  type: project
---

On this Windows machine (Bash tool = Git Bash), `\` inside Bash tool commands (heredocs AND single-quoted `-e` strings) is collapsed to `\` before the interpreter sees it. Confirmed: writing `\b` in a node heredoc delivered `\b` to node.

**Why:** the shell/harness layer re-processes the command string; my first "verify the fix" attempts reported the fixed regex still failing purely because of this.

**How to apply:** when a Bash tool command must contain literal backslash sequences, build them at runtime instead of typing them: `String.fromCharCode(92)` in node, or `chr(92)` in python. Do not trust heredoc content to be verbatim. Verify file edits afterward with the Read tool (read-only tools are immune).

Also: `python`/`python3` resolve to the Windows Store stub (exits 49, no output). Use `node` for utility scripts. Related test-authoring pitfall: `\b` in a JS template literal passed to `new RegExp(...)` is the backspace escape (U+0008), not a word boundary — use `\b`.

Also: Bash tool commands over ~8KB get truncated on this machine (Windows command-line limit) — a heredoc whose closing delimiter line is beyond the cut fails with "unexpected EOF while looking for matching `'`". Fix: write files in chunks (`cat >` then several `cat >>`), each under ~5KB.
