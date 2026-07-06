# ADR 0001: CLI Contract

## Status

Accepted.

## Context

Agent Recall must work for humans in a terminal and for agents in scripts. It cannot hang in non-TTY mode.

## Decision

Use `citty` for command and argument parsing, `@clack/prompts` for TTY prompts and pickers, and Effect Schema for decoded command contracts.

Bare TTY invocation opens a menu. Commands with flags or non-TTY input never prompt. `--json` never prompts and never emits ANSI.

## Consequences

The CLI boundary stays thin. Human and JSON routes call the same Effect workflows.
