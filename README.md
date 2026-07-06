# Agent Recall

Agent Recall reduces local disk usage from AI coding-agent session history without breaking resume.

It packs cold local sessions into verified zstd archives, stores restore metadata in a local vault, and restores the provider-native files when you need to continue a session.

```bash
pnpm install
pnpm health
pnpm dev --scan --provider devin
pnpm pack:dry-run
pnpm evidence:local
```

## Commands

For local development, prefer the package scripts:

```bash
pnpm health
pnpm dev --doctor
pnpm dev --scan [--provider codex|claude|kiro|cursor|devin] [--json]
pnpm pack:dry-run [--provider codex|claude|kiro|cursor|devin] [--older-than 7d] [--json]
pnpm evidence:local [--json]
```

`pnpm doctor` is pnpm's own built-in command, so Agent Recall uses `pnpm health` for the local prerequisite check.

The raw CLI keeps the same command shape:

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

## Safety Model

Agent Recall is dry-run first.

`pack --dry-run` scans all providers and prints a before/after dry-run table without changing files. In the current CLI build, `pack --apply` is intentionally blocked until restore/list indexing is complete enough to safely remove real provider files. Normal tests use fixtures only. Real local evidence is opt-in through `pnpm evidence:local`. `agent-recall doctor` checks the required `zstd` and `sqlite3` binaries.

Full archive/remove/restore support targets Codex, Claude Code user-level sessions, and Kiro. Cursor and Devin are backup-only until their storage models are safer to mutate. Devin discovery reads `~/.local/share/devin/cli/sessions.db` as SQLite metadata and never reads credentials.

## Local Machine Impact

This is one local machine example, not a universal benchmark.

| Provider | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | 65.6% |
| Claude | 2.10 GB | 457 MB | 78.7% |
| Kiro | 1.95 GB | 190 MB | 90.5% |
| Cursor backup | 7.27 GB | 957 MB | 87.1% |
| Total | 13.5 GB | 2.3 GB | about 83% |

## Round-Trip Proof

Local proof runs copied real sessions into repo-local fixtures, compressed those copies, restored them, and compared SHA-256 hashes. Originals were not touched. `pnpm evidence:local` prints a human table by default; use `pnpm evidence:local --json` for the full machine-readable report.

| Provider | Source | Archive | Saved | Lines | Byte exact | Original touched |
| --- | ---: | ---: | ---: | ---: | --- | --- |
| Kiro latest | 1,160,471 B | 132,557 B | 88.6% | 266 | yes | no |
| Claude oldest | 6,470,568 B | 1,265,093 B | 80.4% | 2,722 | yes | no |
| Codex oldest | 104,229 B | 25,422 B | 75.6% | 24 | yes | no |
| Devin local DB | 97,058,816 B | 13,425,614 B | 86.2% | n/a | yes | no |

See `examples/roundtrip/` for committed before/archive/after fixture proof. Devin proof is generated locally with `pnpm evidence:local` because the SQLite session database is backup-only and should not be committed.
