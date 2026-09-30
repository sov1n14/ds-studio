---
name: long-heredoc-bash-failure
description: Bash tool fails with "unexpected EOF while looking for matching '" on very long heredoc commands (~150+ lines); write large test files in chunks with cat >>
metadata:
  type: feedback
---
Write large files through Bash in chunks of ~100 lines (`cat > f <<'EOF'` then `cat >> f <<'EOF'`); one long heredoc (~300 lines) fails to parse even with a quoted delimiter, and nothing is written.

**Why:** Observed 2026-09-24 writing test/unit/auto-retry.spec.js; the same content succeeded when split. No Write tool was available to the test-engineer agent in that session.

**How to apply:** Any test file over ~120 lines written via Bash.
