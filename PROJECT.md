# PROJECT.md

## Purpose

Agent Session Pack reduces local disk usage from AI coding-agent session history while preserving byte-exact restore into provider-native formats.

## Direction

The project is a CLI-only tool for developers and coding agents. It should make cold-session cleanup safe, inspectable, reversible, and scriptable.

## Users

- Developers with large local AI session histories.
- Coding agents that need stable JSON output and safe restore commands.
- Maintainers who need evidence that compression did not damage session data.
- Agents that need a single command explaining safe non-interactive usage.

## Non-Goals

- No daemon in v1.
- No local web app in v1.
- No mutation of Cursor's native storage in v1.
- No lossy conversion of session logs.
- No background deletion of real session files.

## Success

- `agent-session-pack scan` shows savings, locations, and cold candidates.
- `agent-session-pack guide --json` shows the safe non-interactive command flow for agents.
- `agent-session-pack pack --apply` removes originals only after verified byte-exact restore.
- `agent-session-pack restore <selector>` restores native files by ID, name, slug, or picker.
- Normal tests never read or mutate real home AI session directories.
