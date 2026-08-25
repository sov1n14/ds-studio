---
name: env-no-edit-write-tools
description: This project's code-implementer subagent invocations may run without an Edit/Write tool available — file edits must go through Bash + a throwaway script instead.
metadata:
  type: project
---

At least one code-implementer dispatch in this repo (ds-studio) had only Read, Glob, Grep, ToolSearch, Skill, and Bash available — no Edit or Write tool, and ToolSearch for `select:Edit,Write` returned nothing.

**Why:** Unknown — likely a harness/session configuration choice for this team setup, not something the agent controls.

**How to apply:** If Edit/Write are missing, do not block on it. Use Bash to run a small Node.js script that reads the file, does exact `indexOf`-based string replacement (verify uniqueness before replacing, throw if the anchor isn't found), writes the file back, then delete the script. See [[crlf-line-endings]] for a pitfall this workflow hit.

**Command-size ceiling:** a single Bash command longer than roughly 8 KB is truncated mid-heredoc and fails with "unexpected EOF while looking for matching `''`" while creating nothing. Author files over ~150 lines in two commands (`cat > file <<'EOF'` then `cat >> file <<'EOF'`), then `node --check`.

**Deletion commands are blocked in Bash:** a command containing the unix remove-file utility is rejected by a hook ("Direct delete blocked. Read related skills." — the `file-deletion-policy` skill mandates Recycle Bin deletion). The rejection kills the *whole* compound command, so chaining `cat > /tmp/x.js <<EOF ... && node /tmp/x.js && <delete>` creates nothing and must be re-run. The hook also matches the utility name appearing merely as *text* inside a heredoc body. Keep throwaway scripts in `/tmp` and leave them there.
