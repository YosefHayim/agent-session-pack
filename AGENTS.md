# AGENTS.md

Agent Session Pack is a CLI-only TypeScript tool for reducing local disk usage from AI coding-agent session history while preserving byte-exact restore.

## Working Rules

- Do not touch real AI session directories in normal tests.
- Real local evidence runs must be explicit through `pnpm dev:savings` or `agent-session-pack check`.
- Prefer `agent-session-pack guide --json` or `pnpm dev:guide` when an agent needs the safe command map.
- Use `pack --max --dry-run` only for curiosity previews; never combine `--max` with `--apply`.
- Keep provider modules read-only.
- Centralize destructive behavior in the archive, pack, and restore workflows.
- Preserve exact source bytes before any original file is removed.
- Treat Cursor and Devin as backup-only providers until their stores are safe to mutate.
- Grok and Kimi sessions are multi-file directories; pack/restore whole trees, never only one JSONL.
- Keep `pack --apply` and `unpack --apply` behind explicit confirmation or `--yes`.
- Write restore manifests before removing originals.
- Make lifecycle setup explicit: provider choice, vault path, cold threshold, and pack-on-close behavior must be shown before any hook writes happen.

## Conventions

- Use `citty` for commands and argument parsing.
- Use `@clack/prompts` only for TTY interaction.
- Use stable JSON output for agents and compact tables for humans.

## Repo Layout

```text
src/
  cli/           # binary entry, argv routing, interactive menu
  features/      # one folder per feature: command, workflow, output, tests
    archive/     # zstd archives, hashes, manifests, vault paths, stubs
    doctor/
    evidence/
    guide/
    lifecycle/
    pack/
    restore/
    scan/
    setup/
  providers/     # read-only native store discovery per agent
  shared/        # session model and helpers used by two or more features
  **/*.test.ts   # unit tests colocated next to source
tests/           # shared helpers/fixtures + optional *.integration.test.ts
examples/hello-world/
.github/workflows/
```

Imports point one way: `cli` -> `features` -> `providers` -> `shared`.

## Canonical Docs

Root guidance stays compact. Deeper detail lives in dedicated files:

- `PROJECT.md`: purpose, direction, non-goals.
- `CONTEXT.md` and `LANGUAGE.md`: domain model and vocabulary.

## Validation

Run before claiming work is complete:

```bash
pnpm check
```

`pnpm check` runs lint, typecheck, test and build through Turborepo. Public CI runs test and build on pushes to `main`. A pre-commit hook runs Biome on staged files; a new worktree needs `pnpm install` before its first commit.
