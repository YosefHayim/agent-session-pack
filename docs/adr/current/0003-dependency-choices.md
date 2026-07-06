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
- `better-sqlite3`

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

- `zstd`, checked by `agent-recall doctor`.

## Consequences

Agent Recall keeps compression native and transparent while using TypeScript libraries for command and data contracts.
