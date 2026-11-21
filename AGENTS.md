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

- Use Node `util.parseArgs` for commands and argument parsing.
- Use Node `readline` only for TTY questions.
- Use stable JSON output for agents and compact tables for humans.

## Repo Layout

```text
src/
  prompts.ts     # TTY questions. Commands import this, so it stays out of cli.ts
  providers.ts   # read-only native store discovery
  archive.ts     # home, exit type, bytes, vault, zstd, hash, manifest, fixtures
  pack.ts        # cold plan and pack. Deletes originals only after a verified archive
  restore.ts     # unpack and restore-on-open
  scan.ts        # inventory and savings evidence
  setup.ts       # first-run settings
  lifecycle.ts   # wrappers, pack-on-exit, maintain, preflight
  cli.ts         # binary entry. Emits dist/cli.js
  *.test.ts      # unit tests next to the file they cover
e2e/             # end-to-end CLI tests, run by npm run test:e2e
.github/workflows/
```

`cli.ts` calls the commands. `archive.ts` is the shared bottom and does not import pack, scan, or setup. `providers.ts` does not import `archive.ts`. `scan.ts` and `pack.ts` import each other. `restore.ts` and `lifecycle.ts` import each other. Use relative specifiers that end in `.js`. The published bin is plain `tsc` output.

## Validation

Run before claiming work is complete:

```bash
pnpm check
```

`pnpm check` runs lint, typecheck, test and build. Public CI runs test and build on pushes to `main` with `pnpm install --frozen-lockfile`. A pre-commit hook runs Biome on staged files. Commit `pnpm-lock.yaml`. A new worktree needs `pnpm install` before its first commit.
