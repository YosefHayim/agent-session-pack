# Agent Recall Code Style

This guide is the source of truth for how Agent Recall code is written. Existing proof-spike code is evidence, not precedent.

## Purpose

Agent Recall is a CLI-only tool that reduces local disk usage from AI coding-agent session history without breaking resume, restore, or conversation quality.

## Formatting

- Formatter: Biome.
- Indent: 2 spaces.
- Quotes: single quotes.
- Semicolons: required.
- Trailing commas: all multiline positions.
- Line width: 100.
- Imports: organized by tooling.
- Filenames: camelCase TypeScript files. Do not use kebab-case source filenames.

## TypeScript Shape

### Exported Functions

Use arrow const exports with explicit parameter and return types.

Chosen:

```ts
export const discoverStoreSessions = (
  adapter: ProviderAdapter,
  store: SessionStore,
): Effect.Effect<ReadonlyArray<DiscoveredSession>, SessionDiscoveryError> =>
  Effect.gen(function* () {
    const exists = yield* pathExists(store.path);

    if (!exists) {
      return [];
    }

    const sessions = yield* adapter.discover(store);

    return sessions;
  });
```

Rejected:

```ts
export async function discoverStoreSessions(adapter, store) {
  return adapter.discover(store);
}
```

Rules:

- Exported app APIs use `export const name = (...) => ...`.
- Exported APIs include TSDoc with `@param` and `@returns`.
- Explicit params and return types are required.
- `function*` is allowed only as an `Effect.gen` callback.
- Avoid nested conditions; prefer guard returns.
- Do not scatter `??` defaults through workflows. Normalize defaults once at the boundary.

## Effects, Schemas, And Errors

Use Effect for workflows, expected errors, schemas, provider scanning, filesystem operations, compression, restore, config, and manifests.

- Runtime schemas use `effect/Schema`.
- Expected failures are typed Effect errors.
- Domain/application code does not use `throw new Error()`.
- CLI boundary code renders errors to human text, JSON, and exit codes.

Chosen:

```ts
export class ProviderStoreMissingError extends Schema.TaggedError<ProviderStoreMissingError>()(
  'ProviderStoreMissingError',
  {
    provider: ProviderIdSchema,
    path: Schema.String,
  },
) {}
```

## Module Boundaries

Providers never write. Provider modules discover and describe native sessions only.

- `src/providers/*`: native store roots, discovery, title/date/id extraction.
- `src/core/archiveWriter.ts`: create zstd archive, verify restore hash, remove original only after verification.
- `src/core/manifestStore.ts`: write/read restore metadata.
- `src/core/sessionIndex.ts`: SQLite search/list/cache.
- `src/output/*`: human and JSON rendering.
- `src/cli/*`: citty commands, Clack TTY prompts, exit mapping.

No `utils.ts`, `helpers.ts`, or `common.ts` dumping grounds.

## CLI Contract

Agent Recall is CLI-only.

- Bare TTY invocation opens a Clack menu.
- TTY commands with missing interactive input use Clack prompts or pickers.
- Flags or non-TTY never prompt or hang.
- `--json` never prompts and never emits ANSI.
- Long flags are preferred. Only obvious short aliases like `-h` and `-v` are allowed.
- Durations accept `7d`, `2w`, `30d`, and `12h`.
- `--provider` is repeatable.

Commands:

```bash
agent-recall init [--apply] [--json]
agent-recall scan [--provider codex|claude|kiro|cursor|devin] [--json]
agent-recall pack [--provider codex|claude|kiro|cursor|devin] [--older-than 7d] [--dry-run|--apply] [--json]
agent-recall list [--provider codex|claude|kiro|cursor|devin] [--json]
agent-recall restore <selector> [--to original|<path>] [--json]
agent-recall pin <selector>
agent-recall unpin <selector>
agent-recall doctor [--json]
agent-recall prune [--quarantine] [--dry-run|--apply]
```

## Output Contract

Human output starts with a compact summary, then tables. Scan output includes provider, session count, current size, archived size, savings, and location path. Per-session output includes ID, provider, date, size, savings, status, name, and path.

JSON output has a stable object shape, machine-readable errors, no ANSI, and no prompts.

## Vocabulary

- `vault`: `~/.agent-recall`.
- `store`: provider local session root, such as `~/.codex/sessions`.
- `session`: one conversation/log.
- `archive`: compressed content-addressed `.zst` object.
- `manifest`: restore metadata.
- `tombstone`: metadata proving the original was removed only after verified archive.
- `backup`: use only for Cursor and Devin backup-only modes.

Avoid `memory` in code identifiers because it confuses RAM with disk.

## Status Names

- `live`: original file still exists.
- `cold`: eligible to pack.
- `archived`: packed and original removed after verification.
- `restored`: unpacked back into native location.
- `pinned`: excluded from packing.
- `quarantined`: metadata retained for explicit prune/recovery.

## Never

- No `utils.ts`, `helpers.ts`, or `common.ts` dumping grounds.
- No top-level `function foo()` declarations in app code.
- No nested ternaries.
- No nested `if` ladders when guard returns work.
- No scattered `??` defaults in workflows.
- No `throw new Error()` inside domain/application code.
- No one-use wrapper functions unless they name a real domain concept.
- No defensive `isRecord`-style micro-helpers when Effect Schema should validate.
- No vague names like `data`, `result`, `item`, or `thing` when a domain name exists.
- No normal tests against real home directories.

## Tests

- `pnpm test`: synthetic fixtures only.
- `pnpm test:integration`: temp HOME and temp provider roots only.
- `pnpm evidence:local`: explicit local machine proof against real sessions.
- Round-trip tests assert SHA-256 byte-exact restore.
- Dry-run tests assert originals are not touched.
- Selector tests cover ID, exact name, slug, fuzzy query, provider-prefixed selector, and ambiguity.

## Golden Exemplar Targets

The current proof spike is legacy, not an exemplar. The first real exemplars are:

- `src/cli/commands/scanCommand.ts`
- `src/core/archiveWriter.ts`
- `src/providers/codex.ts`

## Dependencies

Runtime:

- `effect`
- `citty`
- `@clack/prompts`

Dev:

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
- `sqlite3`, checked by `agent-recall doctor` for Devin session discovery.
