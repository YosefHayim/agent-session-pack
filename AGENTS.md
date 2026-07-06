# AGENTS.md

Agent Recall is a CLI-only TypeScript tool for reducing local disk usage from AI coding-agent session history while preserving byte-exact restore.

## Working Rules

- Do not touch real AI session directories in normal tests.
- Real local evidence runs must be explicit through `pnpm evidence:local`.
- Keep provider modules read-only.
- Centralize destructive behavior in core archive/restore workflows.
- Preserve exact source bytes before any original file is removed.
- Treat Cursor and Devin as backup-only providers until their stores are safe to mutate.
- Keep `pack --apply` blocked until restore/list indexing is complete enough for safe recovery.

## Conventions

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

- Use Effect workflows, Effect Schema contracts, and typed Effect errors.
- Export app APIs as arrow const functions with explicit params and return types.
- Add TSDoc to exported APIs.
- Use camelCase filenames. Do not add kebab-case source files.
- Do not add `utils.ts`, `helpers.ts`, or `common.ts`.
- Do not use raw `throw new Error()` in domain/application code.
- Do not use normal tests against real home session directories.
- Use `@clack/prompts` only for TTY interaction.
- Use `citty` for commands and argument parsing.
- Use stable JSON output for agents and compact tables for humans.

## Repo Layout

```text
src/
  cli/
    main.ts
    commands/
  core/
  providers/
  output/
tests/
examples/roundtrip/
scripts/
  evidenceLocal.ts
  dev/       # ignored scratch
docs/adr/current/
.github/workflows/
```

## Validation

Run before claiming work is complete:

```bash
pnpm check:ci
pnpm typecheck
pnpm test
pnpm build
```
