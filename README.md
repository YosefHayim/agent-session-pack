<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack - shrink local AI coding-agent session history into a tiny verified archive" width="640" />
</p>

# Agent Session Pack

Cold storage for local AI coding-agent sessions.

[![npm](https://img.shields.io/npm/v/agent-session-pack?label=npm)](https://www.npmjs.com/package/agent-session-pack)
[![CI](https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml/badge.svg)](https://github.com/YosefHayim/agent-session-pack/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

Agent Session Pack is a [Node.js](https://nodejs.org/en) CLI for developers and
coding agents whose local [OpenAI Codex CLI](https://developers.openai.com/codex/cli),
[Claude Code](https://www.anthropic.com/product/claude-code),
[Kiro CLI](https://kiro.dev/docs/cli/), [Grok](https://grok.x.ai/),
[Kimi Code](https://www.kimi.com/), [OpenCode](https://opencode.ai/),
[Gemini CLI](https://geminicli.com/), [Cursor](https://cursor.com/docs), or
[Devin CLI](https://docs.devin.ai/cli) histories have grown large. It finds local
session stores, proves lossless [Zstandard](https://facebook.github.io/zstd/)
compression on copies, and packs cold sessions into a local vault only when you ask it to.

Current status: `v0.3.0` ships guided setup, read-only proof, manual pack/unpack/restore,
and an **opt-in** `ensure-restored` helper for restore-on-launch workflows. It does not
install a daemon, timer, pack-on-close hook, web app, cloud sync, or lossy conversation
summarizer. Restore-on-launch stays off until `lifecycle enable`.

## Quick Start

Run the safest proof from anywhere:

```bash
npx --yes agent-session-pack check
```

`check` scans supported local provider stores, copies one eligible session per provider
into a temp proof workspace, compresses the copy, restores it, compares hashes, and prints
a before/after savings table. Real session files stay untouched.

For coding agents and automation, ask for the command map first:

```bash
npx --yes agent-session-pack guide --json
```

For humans, open the guided terminal menu:

```bash
npx --yes agent-session-pack
```

Install globally only if you want the command on your path:

```bash
npm install -g agent-session-pack
agent-session-pack
```

Requirements:

- [Node.js](https://nodejs.org/en) 20 or newer.
- `zstd` for proof, pack, and restore workflows.
- `sqlite3` only when discovering Devin session metadata.
- `HOME` must be set so vault and provider paths resolve (normal on macOS/Linux shells; see [`.env.example`](.env.example)).

## What It Does

```text
provider stores
   |
   | read-only scan
   v
temp proof copy ---------------------> savings table
   |
   | pack --apply only
   v
~/.agent-session-pack/
archives + manifests
   |
   | unpack --apply
   v
original provider paths
```

The tool works in three explicit phases:

1. Prove savings on copied files with `check` or `savings`.
2. Preview cold-session packing with `pack --dry-run`.
3. Apply archive/remove only with `pack --apply`, after byte-exact restore verification.

Setup saves configuration only. It does not wait for the threshold and compress later.

## Common Commands

Copy-only proof:

```bash
npx --yes agent-session-pack check
npx --yes agent-session-pack savings
```

Review discovered session stores:

```bash
npx --yes agent-session-pack scan
```

Preview cold-session packing across supported providers:

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run
```

Preview every archive-mode candidate without touching files:

```bash
npx --yes agent-session-pack pack --max --dry-run
```

Apply after reviewing the dry-run table:

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply
```

Non-interactive apply for automation:

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply --yes --json
```

Restore archived sessions back to their original provider paths:

```bash
npx --yes agent-session-pack unpack --all-providers --apply
```

`--older-than` is the cold-session age filter:

- `12h`: shorter cleanup window.
- `1d`: skip roughly today's active work.
- `7d`: default setup policy.
- `30d`: conservative archive pass.
- `--max --dry-run`: curiosity preview for every archive-mode session.

`npx --yes` belongs to [npm](https://docs.npmjs.com/cli/v8/commands/npx). It approves
temporary package execution. Agent Session Pack writes are confirmed separately with
`--apply` and, for automation, app-level `--yes`.

## Provider Modes

| Provider | Mode | Notes |
| --- | --- | --- |
| Codex | Archive | Local session files can be packed and restored. |
| Claude Code | Archive | User-level sessions can be packed and restored. |
| Kiro | Archive | CLI sessions can be packed and restored. |
| Cursor | Backup-only | Included in scan/proof output, not destructively packed. |
| Devin | Backup-only | Reads local SQLite metadata from `~/.local/share/devin/cli/sessions.db`; does not read credentials. |

Backup-only means the provider can appear in proof output, but native store mutation is
disabled until the storage model is safer to change.

## Safety Model

Agent Session Pack is built around byte-exact restore, not best-effort cleanup.

- `check` and `savings` operate on copied files.
- `pack --all-providers` defaults to dry-run.
- `pack --apply` asks for confirmation in a TTY unless `--yes` is passed.
- `pack --max --apply` is refused.
- Apply mode writes an archive, restores it to verify SHA-256 equality, writes a
  manifest, and only then removes the original.
- `unpack --apply` restores from manifests and skips changed live files instead of
  overwriting them.
- Cursor and Devin are backup-only in `v0.3.0`.

## Local Evidence

This is one machine's evidence, not a universal benchmark.

| Provider | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | 65.6% |
| Claude | 2.10 GB | 457 MB | 78.7% |
| Kiro | 1.95 GB | 190 MB | 90.5% |
| Cursor backup | 7.27 GB | 957 MB | 87.1% |
| Total | 13.5 GB | 2.3 GB | about 83% |

Committed fixtures in [examples/roundtrip](examples/roundtrip/) show tiny before,
archive, and after files for Codex, Claude, and Kiro. Run `agent-session-pack check` on
your own machine for real local evidence.

## Alternatives And Neighboring Tools

Agent Session Pack is intentionally narrow: it archives cold local AI session files and
verifies byte-exact restore before removing originals. It pairs well with usage, search,
and general disk-analysis tools.

| Tool | Main focus | Difference |
| --- | --- | --- |
| [`ccusage`](https://ccusage.com/guide/) | Coding-agent token and cost reports | Explains usage; does not pack local session stores. |
| [`claude-code-history-viewer`](https://github.com/jhlee0409/claude-code-history-viewer) | Offline browsing and search for AI coding histories | Views histories; does not own archive/remove/restore. |
| [`claude-code-cleaner`](https://github.com/garrickz2/claude-code-cleaner) | Claude Code disk cleanup | Claude-focused cleanup; not a multi-provider verified vault. |
| `zstd`, `tar`, backups, disk analyzers | Generic storage tools | Compress or locate bytes; do not understand provider sessions or restore manifests. |

## FAQ

<details>
<summary>Does setup automatically compress sessions later?</summary>

No. Setup writes config only. It does not start a daemon, timer, cron job, or lifecycle
hook. Sessions are compressed only when you run a pack command such as:

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply
```
</details>

<details>
<summary>Can agents still resume sessions after packing?</summary>

The archive is byte-exact, but a provider can only resume from its native file location.

**Manual path (always available):**

```bash
npx --yes agent-session-pack unpack --all-providers --apply --yes --json
# or one session:
npx --yes agent-session-pack restore codex:<session-id> --json
```

**Opt-in restore-on-launch helper** (for agents/wrappers before resume):

```bash
npx --yes agent-session-pack lifecycle enable --json
npx --yes agent-session-pack ensure-restored --provider codex <session-id> --json
```

`ensure-restored` restores byte-exact native files when lifecycle is enabled, skips when
the live file already matches, and refuses to overwrite a changed live file. Disable with
`lifecycle disable` to fall back to manual `unpack` / `restore` only. No provider daemon
or pack-on-close hook is installed automatically.
</details>

<details>
<summary>Is this context compaction or summarization?</summary>

No. Agent Session Pack does not summarize, rewrite, truncate, or semantically compress a
conversation. It uses lossless archive compression and verifies byte-exact restore.
</details>

<details>
<summary>How do I pack old sessions but skip today?</summary>

Use `--older-than 1d` to pack only sessions modified more than 24 hours ago:

```bash
npx --yes agent-session-pack pack --all-providers --older-than 1d --apply
```
</details>

<details>
<summary>Does it read credentials or upload sessions?</summary>

No. The tool is local-first. It scans local provider stores and writes local proof
workspaces or local archives. Devin support reads SQLite metadata from the local sessions
database and does not read credentials.
</details>

<details>
<summary>How is this different from deleting old session files?</summary>

Deletion is one-way. Agent Session Pack writes an archive, verifies the archive can
restore the exact original bytes, writes a manifest, and only then removes the original in
apply mode.
</details>

## International Summaries

Full documentation is maintained in English. These short summaries help discovery and
quick orientation.

<details>
<summary>日本語</summary>

Agent Session Pack は、ローカルの AI コーディングエージェントのセッション履歴を圧縮して
ディスク使用量を減らす CLI ツールです。`check` はコピーだけで検証し、元のセッションは変更しません。
</details>

<details dir="rtl">
<summary>עברית</summary>

Agent Session Pack הוא כלי CLI שמקטין שימוש בדיסק של היסטוריית סשנים מקומית של סוכני
קוד. `check` עובד על עותקים בלבד ולא משנה קבצים מקוריים.
</details>

<details>
<summary>Español</summary>

Agent Session Pack es una CLI para reducir el espacio usado por historiales locales de
agentes de programación con IA. `check` prueba la compresión sobre copias.
</details>

<details>
<summary>中文（简体）</summary>

Agent Session Pack 是一个 CLI 工具，用于压缩本地 AI 编程代理的会话历史并减少磁盘占用。
`check` 只处理副本，不修改原始会话。
</details>

## Development

Agent Session Pack is written in [TypeScript](https://www.typescriptlang.org/) with
[Effect Schema](https://effect.website/docs/schema/introduction/) for runtime contracts,
[citty](https://unjs.io/packages/citty) for command parsing, and
[Clack](https://bomb.sh/docs/clack/basics/getting-started/) for the interactive TTY.
The repo uses [pnpm](https://pnpm.io/) and [GitHub Actions](https://docs.github.com/en/actions).

```bash
pnpm install
pnpm check:ci
pnpm typecheck
pnpm test
pnpm build
```

Project intent lives in [PROJECT.md](PROJECT.md). Agent editing rules live in
[AGENTS.md](AGENTS.md). Code style and command contracts live in
[CODE-STYLE.md](CODE-STYLE.md). Architecture decisions live in
[docs/adr/current](docs/adr/current/). The public AI index lives in
[llms.txt](llms.txt), following the [llms.txt](https://llmstxt.org/) convention.
