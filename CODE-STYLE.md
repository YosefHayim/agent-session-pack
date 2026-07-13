# Agent Session Pack Code Style

This guide is the source of truth for how Agent Session Pack code is written. Existing proof-spike code is evidence, not precedent.

## Purpose

Agent Session Pack is a CLI-only tool that reduces local disk usage from AI coding-agent session history without breaking resume, restore, or conversation quality.

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
- Explicit params and return types are required.
- `function*` is allowed only as an `Effect.gen` callback.
- Avoid nested conditions; prefer guard returns.
- Do not scatter `??` defaults through workflows. Normalize defaults once at the boundary.

## TSDoc

Every exported symbol carries TSDoc. This is enforced, not aspirational: `eslint-plugin-jsdoc` fails `pnpm check:ci` when an export is missing its required tags. `[lint: jsdoc/require-jsdoc, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-example]`

- Exported functions (arrow-const callables and function declarations) require a one-line summary, `@param name - description` for every parameter, `@returns description`, and a runnable `@example`.
- Exported non-callables (`effect/Schema` consts, `TaggedError` classes, `citty` `defineCommand` objects, type aliases, interfaces, and plain object consts like provider adapters) require a one-line summary only. Do not add `@param`, `@returns`, or `@example` to these.
- Use the TSDoc dash form: `@param name - text`.
- Summaries are present-tense single sentences that name the domain concept, not the mechanics.

Chosen:

```ts
/**
 * Writes a compressed archive and verifies byte-exact restore before removal is allowed.
 *
 * @param request - Source session and destination archive paths.
 * @returns Verified archive metadata for the manifest and index.
 * @example
 * ```ts
 * const verified = yield* writeVerifiedArchive({ source, destination });
 * ```
 */
export const writeVerifiedArchive = (
  request: ArchiveWriteRequest,
): Effect.Effect<VerifiedArchive, ArchiveWriteError> => ...;
```

Rejected:

```ts
// No TSDoc, or a bare summary with no @param / @returns / @example on a function.
export const writeVerifiedArchive = (request: ArchiveWriteRequest) => ...;
```

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
- `src/core/archiveWriter.ts`: create zstd archive and verify restore hash.
- `src/core/sessionArchive.ts`: pack/unpack workflows, manifests, and remove/restore safety.
- `src/core/manifestStore.ts`: write/read restore metadata.
- `src/core/sessionIndex.ts`: SQLite search/list/cache.
- `src/output/*`: human and JSON rendering.
- `src/cli/*`: citty commands, Clack TTY prompts, exit mapping.

No `utils.ts`, `helpers.ts`, or `common.ts` dumping grounds.

## CLI Contract

Agent Session Pack is CLI-only.

- Bare TTY invocation opens a Clack menu.
- Bare TTY menu options use Clack `hint` copy for short, dim explanatory descriptions.
- First setup explains the safety model before prompts, scans providers with a TTY spinner,
  uses provider multi-select, and validates the vault path before config writes.
- TTY commands with missing interactive input use Clack prompts or pickers.
- Flags or non-TTY never prompt or hang.
- `--json` never prompts and never emits ANSI.
- Long flags are preferred. Only obvious short aliases like `-h` and `-v` are allowed.
- Durations accept `7d`, `2w`, `30d`, and `12h`.
- `--provider` is repeatable.

Commands:

```bash
agent-session-pack guide [--json]
agent-session-pack check [--provider codex|claude|kiro|cursor|devin] [--json]
agent-session-pack init [--apply] [--json]
agent-session-pack scan [--provider codex|claude|kiro|cursor|devin] [--json]
agent-session-pack pack [--all-providers|--provider codex|claude|kiro|cursor|devin] [--older-than 7d|--max] [--dry-run|--apply] [--yes] [--json]
agent-session-pack unpack [--all-providers|--provider codex|claude|kiro|cursor|devin] [--apply] [--yes] [--json]
agent-session-pack savings [--provider codex|claude|kiro|cursor|devin] [--json]
agent-session-pack list [--provider codex|claude|kiro|cursor|devin] [--json]
agent-session-pack restore <selector> [--to original|<path>] [--json]
agent-session-pack pin <selector>
agent-session-pack unpin <selector>
agent-session-pack doctor [--json]
agent-session-pack prune [--quarantine] [--dry-run|--apply]
```

Local package scripts should cover the common human paths:

```bash
pnpm health
pnpm guide
pnpm dev --check
pnpm dev --doctor
pnpm dev --scan --provider devin
pnpm savings
pnpm pack:dry-run
pnpm pack:all
pnpm unpack:all
pnpm evidence:local
```

## Output Contract

Human output starts with a compact summary, then tables. Scan output includes provider, session count, current size, archived size, savings, and location path. Per-session output includes ID, provider, date, size, savings, status, name, and path.

JSON output has a stable object shape, machine-readable errors, no ANSI, and no prompts.

## Vocabulary

- `vault`: `~/.agent-session-pack`.
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

## Over-Engineering

One test: an abstraction earns its place only if it has a second real caller or names a genuine domain concept. Otherwise inline it. The recurring offenders are listed under `Never`; the reference anti-example is the removed `createJsonlProviderAdapter`, an identity wrapper `(adapter) => adapter` that added an import and a doc block while doing nothing.

## Never

- No `utils.ts`, `helpers.ts`, or `common.ts` dumping grounds.
- No top-level `function foo()` declarations in app code.
- No nested ternaries.
- No nested `if` ladders when guard returns work.
- No scattered `??` defaults in workflows.
- No `throw new Error()` inside domain/application code.
- No no-op or identity wrappers.
- No one-use wrapper functions unless they name a real domain concept.
- No copy-pasted micro-helper across files; inline the trivial ones, and give a genuine shared concept one home in the module that owns it.
- No defensive `isRecord`-style micro-helpers when Effect Schema should validate.
- No vague names like `data`, `result`, `item`, or `thing` when a domain name exists.
- No normal tests against real home directories.

## Tests

- `pnpm test`: synthetic fixtures only.
- `pnpm test:integration`: temp HOME and temp provider roots only.
- `pnpm guide`: agent-first command map for safe non-interactive use.
- `npx agent-session-pack check`: no-install copy-only local proof after publish.
- `npx agent-session-pack pack --max --dry-run`: all-age pack preview; never apply with `--max`.
- `pnpm savings`: explicit local machine proof against copied real sessions.
- `pnpm evidence:local`: alias kept for existing proof notes.
- `pnpm pack:dry-run` and `pnpm pack:all`: non-destructive all-provider cleanup summary.
- `pnpm unpack:all`: non-destructive all-provider restore summary from the vault.
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
- `eslint-plugin-jsdoc`

External binary:

- `zstd`, checked by `agent-session-pack doctor`.
- `sqlite3`, checked by `agent-session-pack doctor` for Devin session discovery.
