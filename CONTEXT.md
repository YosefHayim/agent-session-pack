# CONTEXT.md

Agent Session Pack is a local CLI that manages cold AI coding-agent session files.

The system has three important locations:

- Provider stores: native session roots such as `~/.codex/sessions`, `~/.claude/projects`, and `~/.kiro/sessions`.
- Vault: Agent Session Pack's own storage under `~/.agent-session-pack`.
- Working fixtures: test-only temp directories and committed examples.

Provider modules discover sessions and extract metadata. Core modules pack, verify, index, restore, and protect sessions. CLI modules parse arguments, prompt in TTY mode, and render human or JSON output.

The critical invariant is byte preservation. A packed session is useful only when restoring it produces the exact original bytes and enough metadata to put it back where the provider expects it.
