# AGENTS.md

Agent Session Pack is a CLI-only TypeScript tool for reducing local disk usage from AI coding-agent session history while preserving byte-exact restore.

## Working Rules

- Do not touch real AI session directories in normal tests.
- Real local evidence runs must be explicit through `pnpm savings`, `pnpm evidence:local`, or `agent-session-pack check`.
- Prefer `agent-session-pack guide --json` or `pnpm guide` when an agent needs the safe command map.
- Use `pack --max --dry-run` only for curiosity previews; never combine `--max` with `--apply`.
- Keep provider modules read-only.
- Centralize destructive behavior in core archive/restore workflows.
- Preserve exact source bytes before any original file is removed.
- Treat Cursor and Devin as backup-only providers until their stores are safe to mutate.
- Keep `pack --apply` and `unpack --apply` behind explicit confirmation or `--yes`.
- Write restore manifests before removing originals.
- Make lifecycle setup explicit: provider choice, vault path, cold threshold, and pack-on-close behavior must be shown before any hook writes happen.

## Conventions

<!-- rules digest - full guide in CODE-STYLE.md; edit there -->

- Use Effect workflows, Effect Schema contracts, and typed Effect errors.
- Export app APIs as arrow const functions with explicit params and return types.
- Add TSDoc to every export (CI-enforced via `eslint-plugin-jsdoc`): functions need summary + `@param` + `@returns` + `@example`; schemas, errors, `defineCommand` objects, and types need a summary only.
- Use camelCase filenames. Do not add kebab-case source files.
- Do not add `utils.ts`, `helpers.ts`, or `common.ts`.
- No over-engineering: an abstraction needs a second caller or a real domain name, else inline it. No no-op/identity wrappers, one-use wrappers, or cross-file copy-pasted micro-helpers.
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

## Canonical Docs

Root guidance stays compact. Deeper detail lives in dedicated files:

- `PROJECT.md`: purpose, direction, non-goals.
- `CONTEXT.md` and `LANGUAGE.md`: domain model and vocabulary.
- `CODE-STYLE.md`: full code style, CLI contract, and test policy.
- `docs/adr/current`: architecture decisions.

## Validation

Run before claiming work is complete:

```bash
pnpm check:ci
pnpm typecheck
pnpm test
pnpm build
```
