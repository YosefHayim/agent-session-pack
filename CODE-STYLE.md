# agent-session-pack code style

This guide is the source of truth for how Agent Session Pack code is written. Existing proof-spike code is evidence, not precedent.

## How to read a rule

| Slot | Meaning |
| --- | --- |
| rule ID | Stable review and detector key |
| verify | Cheapest command that proves the rule, or judgment |
| chosen / rejected | The local idiom and the concrete failure shape |

## Rules

### Formatter: Biome
[rule:formatter.biome] · verify: judgment

Formatter: Biome.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Indent: 2 spaces
[rule:indent.2-spaces] · verify: judgment

Indent: 2 spaces.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Quotes: single quotes
[rule:quotes.single-quotes] · verify: judgment

Quotes: single quotes.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Semicolons: required
[rule:semicolons.required] · verify: judgment

Semicolons: required.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Trailing commas: all multiline positions
[rule:trailing.commas-all-multiline-positions] · verify: judgment

Trailing commas: all multiline positions.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Line width: 100
[rule:line.width-100] · verify: judgment

Line width: 100.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Imports: organized by tooling
[rule:imports.organized-by-tooling] · verify: judgment

Imports: organized by tooling.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Filenames: camelCase TypeScript files. Do not
[rule:filenames.camelcase-typescript-files-do-not] · verify: judgment

Filenames: camelCase TypeScript files.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Exported Functions
[rule:exported.functions] · verify: judgment

Use arrow const exports with explicit parameter and return types.

```ts
// ✓ chosen
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
// ✗ rejected
```

Why: Keeps the local idiom consistent and reviewable.

### Prefer domain names for locals, parameters,
[rule:prefer.domain-names-for-locals-parameters] · verify: judgment

Prefer domain names for locals, parameters, and helpers (`packPlanRow`, `inventoryReport`, `vaultPathValidation`).

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Ban vague locals when a domain
[rule:ban.vague-locals-when-a-domain] · verify: judgment

Ban vague locals when a domain name exists: `result`, `data`, `payload`, `body`, `response`, `row` (type names like `PackPlanRow` are fine).

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Module-level constants use UPPERSNAKE and sit
[rule:module.level-constants-use-uppersnake-and] · verify: judgment

Module-level constants use `UPPER_SNAKE` and sit after imports.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### No index.ts barrel re-export files. Import
[rule:no.index-ts-barrel-re-export] · verify: judgment

No `index.ts` barrel re-export files.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Do not prefix helpers with normalize.
[rule:do.not-prefix-helpers-with-normalize] · verify: judgment

Do not prefix helpers with `normalize*`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Exported functions (arrow-const callables and function
[rule:exported.functions-arrow-const-callables-and] · verify: judgment

Exported functions (arrow-const callables and function declarations) require a one-line summary, `@param name - description` for every parameter, `@returns description`, and a runnable `@example`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Exported non-callables (effect/Schema consts, TaggedError cl
[rule:exported.non-callables-effect-schema-consts] · verify: judgment

Exported non-callables (`effect/Schema` consts, `TaggedError` classes, `citty` `defineCommand` objects, type aliases, interfaces, and plain object consts like provider adapters) require a one-line summary only.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Use the TSDoc dash form: @param
[rule:use.the-tsdoc-dash-form-param] · verify: judgment

Use the TSDoc dash form: `@param name - text`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Summaries are present-tense single sentences that
[rule:summaries.are-present-tense-single-sentences] · verify: judgment

Summaries are present-tense single sentences that name the domain concept, not the mechanics.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Writes a compressed archive and verifies
[rule:writes.a-compressed-archive-and-verifies] · verify: judgment

Writes a compressed archive and verifies byte-exact restore before removal is allowed.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### @param request - Source session and
[rule:param.request-source-session-and] · verify: judgment

@param request - Source session and destination archive paths.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### @returns Verified archive metadata for the
[rule:returns.verified-archive-metadata-for-the] · verify: judgment

@returns Verified archive metadata for the manifest and index.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### @example
[rule:example] · verify: judgment

@example.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### ts
[rule:ts] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### const verified = yield writeVerifiedArchive({ source,
[rule:const.verified-yield-writeverifiedarchive-source] · verify: judgment

const verified = yield* writeVerifiedArchive({ source, destination }).

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### 
[rule:rule.item] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Runtime schemas use effect/Schema
[rule:runtime.schemas-use-effect-schema] · verify: judgment

Runtime schemas use `effect/Schema`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Prefer Schema validation at boundaries over
[rule:prefer.schema-validation-at-boundaries-over] · verify: judgment

Prefer Schema validation at boundaries over custom ad-hoc validators when Schema already fits.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Expected failures are typed Effect errors
[rule:expected.failures-are-typed-effect-errors] · verify: judgment

Expected failures are typed Effect errors.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Domain/application code does not use throw
[rule:domain.application-code-does-not-use] · verify: judgment

Domain/application code does not use `throw new Error()`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### CLI boundary code renders errors to
[rule:cli.boundary-code-renders-errors-to] · verify: judgment

CLI boundary code renders errors to human text, JSON, and exit codes.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/providers/: native store roots, discovery, title/date/id
[rule:src.providers-native-store-roots-discovery] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/core/archiveWriter.ts: create zstd archive and verify
[rule:src.core-archivewriter-ts-create-zstd] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/core/sessionArchive.ts: pack/unpack workflows, manifests
[rule:src.core-sessionarchive-ts-pack-unpack] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/core/manifestStore.ts: write/read restore metadata
[rule:src.core-manifeststore-ts-write-read] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/core/sessionIndex.ts: SQLite search/list/cache
[rule:src.core-sessionindex-ts-sqlite-search] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/output/: human and JSON rendering
[rule:src.output-human-and-json-rendering] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### src/cli/: citty commands, Clack TTY prompts,
[rule:src.cli-citty-commands-clack-tty] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Over-Engineering
[rule:over.engineering] · verify: judgment

One test: an abstraction earns its place only if it has a second real caller or names a genuine domain concept.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Unit tests are colocated next to
[rule:unit.tests-are-colocated-next-to] · verify: judgment

Unit tests are colocated next to source as `*.test.ts` under `src/`.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### tests/ holds shared helpers/fixtures and optional
[rule:tests.holds-shared-helpers-fixtures-and] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm test: synthetic fixtures only
[rule:pnpm.test-synthetic-fixtures-only] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm test:integration: temp HOME and temp
[rule:pnpm.test-integration-temp-home-and] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm guide: agent-first command map for
[rule:pnpm.guide-agent-first-command-map] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### npx agent-session-pack check: no-install copy-only local
[rule:npx.agent-session-pack-check-no] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### npx agent-session-pack pack --max --dry-run: all-age
[rule:npx.agent-session-pack-pack-max] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm savings: explicit local machine proof
[rule:pnpm.savings-explicit-local-machine-proof] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm evidence:local: alias kept for existing
[rule:pnpm.evidence-local-alias-kept-for] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm pack:dry-run and pnpm pack:all: non-destructive
[rule:pnpm.pack-dry-run-and-pnpm] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### pnpm unpack:all: non-destructive all-provider restore summar
[rule:pnpm.unpack-all-non-destructive-all] · verify: judgment

Follow this project rule as specified.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Round-trip tests assert SHA-256 byte-exact restore
[rule:round.trip-tests-assert-sha-256] · verify: judgment

Round-trip tests assert SHA-256 byte-exact restore.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Dry-run tests assert originals are not
[rule:dry.run-tests-assert-originals-are] · verify: judgment

Dry-run tests assert originals are not touched.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

### Selector tests cover ID, exact name,
[rule:selector.tests-cover-id-exact-name] · verify: judgment

Selector tests cover ID, exact name, slug, fuzzy query, provider-prefixed selector, and ambiguity.

```ts
// ✓ agent-session-pack idiom

// ✗ rejected shape
```

Why: Keeps the local idiom consistent and reviewable.

## Canonical example

Compose one real feature slice that shows the rules together. Point at real paths once code exists.

## Golden path — adding a unit

1. Name vocabulary changes in LANGUAGE.md / CONTEXT.md when needed.
2. Implement at the owning path for this repository.
3. Wire the unit at its registration seam.
4. Colocate or place tests per the rules above and run the project gate.

Definition of done:

- Focused tests pass.
- Style and typecheck pass.
- No `## Never` tell was introduced.

## Exemplars

The current proof spike is legacy, not an exemplar. The first real exemplars are:

- `src/cli/commands/scanCommand.ts`
- `src/core/archiveWriter.ts`
- `src/providers/codex.ts`

## Never

- No `utils.ts`, `helpers.ts`, or `common.ts` dumping grounds.
- No top-level `function foo()` declarations in app code.
- No nested ternaries.
- No nested `if` ladders when guard returns work.
- No `normalize*` prefix wrappers for defaults or path munging; inline trivial defaults or name helpers by domain purpose.
- No mid-workflow default resolution; resolve optional inputs once at the boundary.
- No `throw new Error()` inside domain/application code.
- No no-op or identity wrappers.
- No one-use wrapper functions unless they name a real domain concept.
- No copy-pasted micro-helper across files; inline the trivial ones, and give a genuine shared concept one home in the module that owns it.
- No defensive `isRecord`-style micro-helpers when Effect Schema should validate.
- No vague names like `result`, `data`, `payload`, `body`, `response`, `row`, `item`, or `thing` when a domain name exists.
- No `index.ts` barrel re-export modules.
- No normal tests against real home directories.

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
