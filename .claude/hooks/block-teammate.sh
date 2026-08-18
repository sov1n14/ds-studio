#!/bin/bash
# PreToolUse hook: block teammate-style delegation (named/addressable agents), force one-shot subagents.
input=$(cat)
tool=$(echo "$input" | jq -r '.tool_name // empty')

deny() {
  jq -cn --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

case "$tool" in
  Agent)
    name=$(echo "$input" | jq -r '.tool_input.name // empty')
    team=$(echo "$input" | jq -r '.tool_input.team_name // empty')
    if [ -n "$name" ] || [ -n "$team" ]; then
      deny "Teammate blocked. Drop name/team_name. One-shot Agent: subagent_type + full-context prompt. Specialist type, never general-purpose."
    fi
    ;;
  SendMessage)
    deny "SendMessage blocked. Spawn fresh Agent. Prompt must carry full background — what to do, how to do it."
    ;;
esac
