# ADR 0003: Dependency Choices

## Status

Accepted.

## Context

The codebase needs typed workflows, runtime schemas, interactive CLI UX, argument parsing, and a local index.

## Decision

Runtime dependencies:

- `effect`
- `citty`
- `@clack/prompts`

Dev dependencies:

- `typescript`
- `tsx`
- `tsup`
- `vitest`
- `@types/node`
- `@biomejs/biome`
- `eslint`
- `typescript-eslint`
- `eslint-plugin-tsdoc`

External binary:

- `zstd`, checked by `agent-session-pack doctor`.
- `sqlite3`, checked by `agent-session-pack doctor` for Devin session discovery.

## Consequences

Agent Session Pack keeps compression native and transparent while using TypeScript libraries for command and data contracts.
