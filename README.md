<!-- Keywords: AI session cleanup, coding agent session history, Claude Code disk usage, Codex CLI sessions, compress JSONL sessions, zstd session archive, byte-exact restore, local-first developer tool -->

<p align="center">
  <a href="https://github.com/YosefHayim/agent-session-pack"><img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack: shrink local AI coding-agent session history into a verified zstd archive and restore it byte-exact" width="820" /></a>
</p>

<p align="center">
  <strong>Cold storage for local AI coding-agent sessions. Shrink Codex, Claude Code, Kiro, Grok, Kimi, OpenCode, and Gemini CLI history on disk, and get every byte back on restore.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/v/agent-session-pack?logo=npm&color=cb3837" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/dm/agent-session-pack?logo=npm&color=cb3837" alt="npm downloads per month" /></a>
  <a href="https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/agent-session-pack/ci.yml?branch=main&logo=github&label=CI" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/agent-session-pack?color=blue" alt="MIT license" /></a>
  <img src="https://img.shields.io/node/v/agent-session-pack?logo=node.js&color=339933" alt="Required Node.js version" />
</p>

<p align="center">
  <img src="https://img.shields.io/badge/agents-9-8957e5" alt="9 coding agents supported" />
  <img src="https://img.shields.io/badge/restore-byte--exact-3fb950" alt="Byte-exact restore" />
  <img src="https://img.shields.io/badge/compression-zstd-informational" alt="zstd compression" />
  <img src="https://img.shields.io/badge/runs-100%25%20local-blue" alt="Runs entirely on your machine" />
</p>

<p align="center">
  <strong>English</strong> · <a href="README.ja.md">日本語</a> · <a href="README.he.md">עברית</a> · <a href="README.es.md">Español</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

**Agent Session Pack** is a [Node.js](https://nodejs.org/en) CLI for developers and coding agents whose local session history has grown large. It finds the session stores of [OpenAI Codex CLI](https://developers.openai.com/codex/cli), [Claude Code](https://code.claude.com/docs/en/overview), [Kiro CLI](https://kiro.dev/docs/cli/), [Grok](https://grok.x.ai/), [Kimi Code](https://www.kimi.com/), [OpenCode](https://opencode.ai/), [Gemini CLI](https://geminicli.com/), [Cursor](https://cursor.com/docs), and [Devin CLI](https://docs.devin.ai/cli), proves lossless [Zstandard](https://facebook.github.io/zstd/) compression on copies, and packs cold sessions into a local vault only when you ask. Every pack restores the archive and compares SHA-256 hashes before an original file is removed.

No daemon, no cloud sync, no summarizing. Your sessions never leave your machine.

## Table of contents

- [Features](#features)
- [Supported agents](#supported-agents)
- [Benchmarks](#benchmarks)
- [Agent Session Pack vs. deleting or zipping](#agent-session-pack-vs-deleting-or-zipping)
- [One-click AI setup](#one-click-ai-setup)
- [Quick start](#quick-start)
- [Commands](#commands)
- [Lifecycle: auto-restore on launch](#lifecycle-auto-restore-on-launch)
- [Safety model](#safety-model)
- [Hello world](#hello-world)
- [Alternatives](#alternatives)
- [FAQ](#faq)
- [Contributing](#contributing)
- [Resources](#resources)
- [License](#license)
- [Contributors](#contributors)

## Features

- **9 coding agents** - Codex, Claude Code, Kiro, Grok, Kimi Code, OpenCode, and Gemini CLI are packed and restored; Cursor and Devin are backup-only.
- **Proof before change** - `check` copies one session per agent, compresses it, restores it, and compares hashes. Real files stay untouched.
- **Byte-exact restore** - every archive is restored and verified with SHA-256 before the original is removed.
- **Dry-run by default** - nothing is removed without `--apply`, and `--apply` asks first unless you pass `--yes`.
- **Cold-session filter** - `--older-than 7d` (or `12h`, `1d`, `2w`, `30d`) keeps your active work untouched.
- **Built for agents** - `guide --json` prints the safe command map, and the scan, check, pack, unpack, restore, and lifecycle commands have stable `--json` output with no prompts.
- **Opt-in lifecycle** - provider wrappers restore a packed session when you open it, and `maintain` re-packs cold ones.
- **Local-first** - no daemon, no network, no credentials read.

## Supported agents

| Agent | Mode | Session store |
| --- | --- | --- |
| Codex | Archive | `~/.codex/sessions` |
| Claude Code | Archive | `~/.claude/projects` |
| Kiro | Archive | `~/.kiro/sessions` |
| Grok | Archive | `~/.grok/sessions` (whole session folders) |
| Kimi Code | Archive | `~/.kimi-code/sessions` (whole session folders) |
| OpenCode | Archive | `~/.local/share/opencode`, `~/.opencode` |
| Gemini CLI | Archive | `~/.gemini`, `~/.gemini/tmp` |
| Cursor | Backup-only | `~/Library/Application Support/Cursor` |
| Devin | Backup-only | `~/.local/share/devin/cli` (reads `sessions.db` metadata only) |

**Archive** means sessions can be packed into the vault and restored. **Backup-only** means the agent is listed as supported, but its native store is never changed. Cursor discovery currently returns no sessions.

## Benchmarks

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/benchmarks.svg" alt="Session storage before and after pack on one machine: Codex 2.22 GB to 782 MB, Claude Code 2.10 GB to 457 MB, Kiro 1.95 GB to 190 MB, Cursor backup 7.27 GB to 957 MB" width="820" />
</p>

| Agent | Before | After | Saved |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | **65.6%** |
| Claude Code | 2.10 GB | 457 MB | **78.7%** |
| Kiro | 1.95 GB | 190 MB | **90.5%** |
| Cursor (backup copy) | 7.27 GB | 957 MB | **87.1%** |
| **Total** | **13.5 GB** | **2.3 GB** | **~83%** |

This is one machine's real session history, not a universal benchmark. Run `npx --yes agent-session-pack check` to measure yours; it only works on copies.

## Agent Session Pack vs. deleting or zipping

| | **Agent Session Pack** | **Deleting old files** | **zstd or tar by hand** |
| --- | --- | --- | --- |
| Get the session back | Byte-exact, verified before removal | Gone for good | Only if you check it yourself |
| Finds every agent's store | Built in for 9 agents | You hunt for paths | You hunt for paths |
| Puts files back where the agent expects | Restore manifest per session | Not applicable | You track paths yourself |
| Changed files on restore | Skipped, never overwritten | Not applicable | Overwritten silently |
| Multi-file sessions (Grok, Kimi) | Packed as whole folders | Easy to half-delete | Easy to miss files |
| Preview first | Dry-run is the default | No | No |

## One-click AI setup

> **Let your coding agent run it for you.** Copy the prompt below into Claude Code, Codex, or any agent with a shell.

<details>
<summary><strong>Click to copy the AI setup prompt</strong></summary>

```
I want to free disk space used by my local AI coding-agent sessions with
Agent Session Pack (https://github.com/YosefHayim/agent-session-pack).

Please:
1. Check that Node.js 20+ and zstd are installed. If zstd is missing, tell me how to install it on my OS.
2. Run: npx --yes agent-session-pack guide --json
   and follow its safe command map.
3. Run: npx --yes agent-session-pack check --json
   and show me the before/after savings per agent. This only touches copies.
4. Run: npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run --json
   and show me which sessions would be packed.
5. Stop and ask me before running anything with --apply.
```

</details>

## Quick start

### 1. Check requirements

- [Node.js](https://nodejs.org/en) 20 or newer.
- [`zstd`](https://facebook.github.io/zstd/) on your `PATH` for proof, pack, and restore.
- `sqlite3` only if you use Devin.
- `HOME` set in your shell (normal on macOS and Linux; see [`.env.example`](.env.example)).

Run `npx --yes agent-session-pack doctor` to check them.

### 2. Prove the savings on copies

```bash
npx --yes agent-session-pack check
```

`check` copies one session per agent into a temp workspace, compresses it, restores it, compares hashes, and prints a before/after table. Real session files stay untouched.

### 3. Preview what would be packed

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run
```

### 4. Pack cold sessions

```bash
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply
```

Each session is archived into `~/.agent-session-pack`, restored and hash-checked, recorded in a manifest, and only then removed from the agent's store.

### 5. Restore when you need them

```bash
npx --yes agent-session-pack unpack --all-providers --apply   # everything
npx --yes agent-session-pack restore SESSION_ID_OR_NAME       # one session
```

Prefer a guided menu? Run `npx --yes agent-session-pack` with no arguments in a terminal. To keep the command on your path, install it globally with `npm install -g agent-session-pack`.

## Commands

| Command | What it does | Changes files |
| --- | --- | --- |
| `guide [--json]` | Safe command map for agents and automation | No |
| `check [--json]` | No-install savings proof on copies | No |
| `savings [--json]` | Same copy-only before/after proof | No |
| `scan [--json]` | Lists session stores, sizes, and cold candidates | No |
| `doctor [--json]` | Checks that `zstd` and `sqlite3` are installed | No |
| `init` | Shows the vault policy; in a terminal, opens guided setup that writes the config | Config only |
| `pack --dry-run` | Previews cold sessions to pack | No |
| `pack --apply [--yes]` | Archives, verifies, then removes originals | Yes |
| `unpack --apply [--yes]` | Restores archived sessions to their original paths | Yes |
| `restore <selector>` | Restores one session by id, name, or slug | Yes |
| `open <session>` | Finds a session and restores it if packed | Yes |
| `lifecycle enable\|disable\|status` | Installs or removes the auto-restore wrappers | Wrappers and config |
| `maintain --apply [--yes]` | Re-packs sessions that went cold again | Yes |

`preflight`, `watch`, and `ensure-restored` are called by the lifecycle wrappers; you rarely run them yourself.

Common flags: `--provider <id>`, `--all-providers`, `--older-than`, `--json`. Agent ids are `codex`, `claude`, `kiro`, `grok`, `kimi`, `opencode`, `gemini`, `cursor`, and `devin`.

<details>
<summary><strong>Choosing <code>--older-than</code></strong></summary>

| Value | Use it for |
| --- | --- |
| `12h` | A short cleanup window |
| `1d` | Skip roughly today's active work |
| `7d` | The default setup policy |
| `30d` | A conservative archive pass |
| `--max --dry-run` | Curiosity preview of every archive-mode session (never with `--apply`) |

</details>

`npx --yes` only approves npm's temporary package download. Agent Session Pack asks for its own confirmation through `--apply` and, for automation, `--yes`.

## Lifecycle: auto-restore on launch

Lifecycle is off until you enable it. Once on, packed sessions come back automatically when an agent opens them.

```bash
# once
npx --yes agent-session-pack lifecycle enable --json
export PATH="$HOME/.agent-session-pack/bin:$PATH"

# open or resume one session (restores it first if packed)
npx --yes agent-session-pack open --provider grok SESSION_ID --json

# keep storage low after restores
npx --yes agent-session-pack maintain --apply --yes --json
```

- The wrappers (`codex`, `claude`, `grok`, ...) run `preflight` on the session ids in the command line, then `watch` while the agent runs.
- Packed sessions leave tiny stubs so they stay listable. When the agent opens a stub, `watch` restores the full session.
- `maintain` re-packs sessions older than your configured `coldAfter` (default `7d`). There is no daemon; schedule it with cron or launchd if you want.
- `lifecycle disable` removes the wrappers.

## Safety model

Agent Session Pack is built around byte-exact restore, not best-effort cleanup.

- `check` and `savings` work on copies only.
- `pack --all-providers` is a dry-run unless you pass `--apply`.
- `pack --apply` asks for confirmation in a terminal unless you pass `--yes`.
- `pack --max --apply` is refused.
- Apply writes the archive, restores it, checks SHA-256 equality, writes a manifest, and only then removes the original.
- `unpack --apply` restores from manifests and skips any live file that changed instead of overwriting it.
- Grok and Kimi sessions are whole folders, so they are packed and restored as whole folders.
- Cursor and Devin are backup-only: their native stores are never changed.

## Hello world

[`examples/hello-world`](examples/hello-world/) holds three tiny synthetic sessions with their real `zstd` archives and restored copies. Two commands prove the archive restores the exact bytes:

```bash
shasum -a 256 < examples/hello-world/before/codex-session.jsonl
zstd -d -c examples/hello-world/archives/codex-session.jsonl.zst | shasum -a 256
```

## Alternatives

Agent Session Pack is intentionally narrow: it archives cold local session files and verifies byte-exact restore. It pairs well with usage, search, and disk-analysis tools.

| Tool | Main focus | Difference |
| --- | --- | --- |
| [`ccusage`](https://ccusage.com/guide/) | Token and cost reports for coding agents | Explains usage; does not pack session stores. |
| [`claude-code-history-viewer`](https://github.com/jhlee0409/claude-code-history-viewer) | Offline browsing and search of AI coding history | Views history; does not archive or restore. |
| [`claude-code-cleaner`](https://github.com/garrickz2/claude-code-cleaner) | Claude Code disk cleanup | Claude only; no verified multi-agent vault. |
| `zstd`, `tar`, backups, disk analyzers | Generic storage tools | Compress or find bytes; do not know agent sessions or restore paths. |

## FAQ

<details>
<summary><strong>Is this context compaction or summarization?</strong></summary>

No. Agent Session Pack never summarizes, rewrites, or truncates a conversation. It uses lossless compression and verifies byte-exact restore.
</details>

<details>
<summary><strong>Can agents still resume sessions after packing?</strong></summary>

Yes. Restore a session with `restore` or `open` before resuming, or enable [lifecycle](#lifecycle-auto-restore-on-launch) so it happens automatically when the agent opens it.
</details>

<details>
<summary><strong>Does setup compress sessions automatically later?</strong></summary>

Setup alone only saves configuration. Packing happens when you run `pack --apply`, or `maintain --apply` after `lifecycle enable`. Nothing runs in the background.
</details>

<details>
<summary><strong>How do I pack old sessions but skip today?</strong></summary>

```bash
npx --yes agent-session-pack pack --all-providers --older-than 1d --apply
```
</details>

<details>
<summary><strong>Does it read credentials or upload sessions?</strong></summary>

No. It scans local stores and writes local archives. For Devin it reads session metadata from the local SQLite database and never reads credentials.
</details>

<details>
<summary><strong>How is this different from deleting old session files?</strong></summary>

Deleting is one-way. Agent Session Pack writes an archive, proves it restores the exact original bytes, writes a manifest, and only then removes the original.
</details>

<details>
<summary><strong>Where are archives stored?</strong></summary>

In the vault at `~/.agent-session-pack`: compressed `.zst` archives plus one JSON manifest per session with the original path and SHA-256 hash.
</details>

## Contributing

Contributions are welcome. Fork, branch, add tests, run the checks, commit with [Conventional Commits](https://www.conventionalcommits.org/), and open a PR. Agent and style rules live in [AGENTS.md](AGENTS.md) and [CODE-STYLE.md](CODE-STYLE.md).

```bash
pnpm install
pnpm check:ci     # Biome + ESLint
pnpm typecheck    # TypeScript
pnpm test         # Vitest, synthetic fixtures only
pnpm build        # tsup to dist/
```

Tests never read or change your real session folders.

## Resources

Project docs:

- [PROJECT.md](PROJECT.md) - purpose, users, and non-goals.
- [CODE-STYLE.md](CODE-STYLE.md) - code style, CLI contract, and test policy.
- [llms.txt](llms.txt) - a compact project summary for AI agents.
- [Releases](https://github.com/YosefHayim/agent-session-pack/releases) and the [issue tracker](https://github.com/YosefHayim/agent-session-pack/issues).

Built with:

- [TypeScript](https://www.typescriptlang.org/), [Effect](https://effect.website/docs), [citty](https://github.com/unjs/citty), and [Clack](https://bomb.sh/docs/clack/basics/getting-started/).
- [pnpm](https://pnpm.io/), [Vitest](https://vitest.dev/), [Biome](https://biomejs.dev/), [tsup](https://tsup.egoist.dev/), and [GitHub Actions](https://docs.github.com/en/actions).
- [Zstandard](https://facebook.github.io/zstd/) and the [llms.txt](https://llmstxt.org/) convention.

## License

MIT - see [LICENSE](LICENSE).

## Contributors

Thanks to everyone who has helped make this project better.

<a href="https://github.com/YosefHayim/agent-session-pack/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=YosefHayim/agent-session-pack" alt="Agent Session Pack contributors" />
</a>

---

<div align="center">

<a href="https://www.buymeacoffee.com/yosefhayim" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" /></a>

<br /><br />

**[Support this project](https://www.buymeacoffee.com/yosefhayim)** · Created by [Yosef Hayim Sabag](https://github.com/YosefHayim)

<sub>Agent Session Pack · cold storage for local AI coding-agent sessions · byte-exact zstd archive and restore for Codex, Claude Code, Kiro, Grok, Kimi, OpenCode, and Gemini CLI.</sub>

</div>
