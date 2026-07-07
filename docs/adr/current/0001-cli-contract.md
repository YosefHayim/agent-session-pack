# ADR 0001: CLI Contract

## Status

Accepted.

## Context

Agent Session Pack must work for humans in a terminal and for agents in scripts. It cannot hang in non-TTY mode.

## Decision

Use `citty` for command and argument parsing, `@clack/prompts` for TTY prompts and pickers, and Effect Schema for decoded command contracts.

Bare TTY invocation opens a menu. Destructive `--apply` commands prompt only in an interactive TTY and can be confirmed with `--yes` for automation. Non-TTY or `--json` apply commands never hang; they require an explicit confirmation path. `--json` never emits ANSI.

`agent-session-pack guide` is the discoverable command map for coding agents. `agent-session-pack guide --json` returns the same safety contract as stable machine-readable JSON.

`pack --max --dry-run` is the all-age curiosity preview. `pack --max --apply` is refused so active or very recent sessions are not packed by accident.

## Consequences

The CLI boundary stays thin. Human and JSON routes call the same Effect workflows.

`agent-session-pack check` is the no-install-friendly proof command after npm publish. It aliases the copy-only savings workflow and must stay safe against real provider stores.
