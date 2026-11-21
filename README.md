# agent-session-pack

Cold storage for local AI coding-agent sessions. Shrink Codex, Claude Code, Kiro, Grok, Kimi, OpenCode, and Gemini CLI history on disk, and get every byte back on restore.

## Why

Local session history grows until it fills the disk. Agent Session Pack finds the stores of [OpenAI Codex CLI](https://developers.openai.com/codex/cli), [Claude Code](https://code.claude.com/docs/en/overview), [Kiro CLI](https://kiro.dev/docs/cli/), [Grok](https://grok.x.ai/), [Kimi Code](https://www.kimi.com/), [OpenCode](https://opencode.ai/), [Gemini CLI](https://geminicli.com/), [Cursor](https://cursor.com/docs), and [Devin CLI](https://docs.devin.ai/cli), proves lossless [Zstandard](https://facebook.github.io/zstd/) compression on copies, and packs cold sessions into a local vault only when you ask. Every pack restores the archive and compares SHA-256 hashes before an original file is removed.

No daemon, no cloud sync, no summarizing. **Your sessions never leave your machine.**

## Quick start

You need [Node.js](https://nodejs.org/en) 22 or newer, and [`zstd`](https://facebook.github.io/zstd/) on your `PATH`. `sqlite3` is only for Devin. `HOME` must be set, which it is on macOS and Linux.

```sh
npx --yes agent-session-pack doctor
npx --yes agent-session-pack check
```

`doctor` checks that the tools are installed. `check` copies one session per agent into a temp workspace, compresses it, restores it, compares hashes, and prints a before/after table. Real session files stay untouched.

To keep the command on your path:

```sh
npm install -g agent-session-pack
yarn global add agent-session-pack
pnpm add -g agent-session-pack
```

## Usage

### Preview, then pack

```sh
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply
```

**`--apply` removes originals** only after the archive is written, restored, and the SHA-256 matches. In a terminal it asks first unless you pass `--yes`. Each session is recorded in a manifest under `~/.agent-session-pack`, and only then removed from the agent's store.

### Restore

```sh
npx --yes agent-session-pack unpack --all-providers --apply
npx --yes agent-session-pack restore SESSION_ID_OR_NAME
```

`restore` and `open` take a session id or its first characters, the name, the slug, or a few words from the name. Add a prefix such as `codex:` to search one agent. If more than one session matches, nothing is restored and the matches are listed.

Run `npx --yes agent-session-pack` with no arguments in a terminal for the guided menu.

### Commands

| Command              | What it does                                             | Changes files       |
| -------------------- | -------------------------------------------------------- | ------------------- |
| `guide`              | Safe command map for agents and automation               | No                  |
| `check`              | No-install savings proof on copies                       | No                  |
| `savings`            | Same copy-only before/after proof                        | No                  |
| `scan`               | Lists session stores, sizes, and cold candidates         | No                  |
| `doctor`             | Checks that `zstd` and `sqlite3` are installed           | No                  |
| `init`               | Shows the vault policy. In a terminal, writes the config | Config only         |
| `pack --dry-run`     | Previews cold sessions to pack                           | No                  |
| `pack --apply`       | Archives, verifies, then removes originals               | Yes                 |
| `unpack --apply`     | Restores archived sessions to their original paths       | Yes                 |
| `restore <selector>` | Restores one session by id, name, slug, or words         | Yes                 |
| `open <session>`     | Finds a session the same way and restores it if packed   | Yes                 |
| `lifecycle enable`   | Installs the auto-restore wrappers                       | Wrappers and config |
| `maintain --apply`   | Re-packs sessions that went cold again                   | Yes                 |

`preflight`, `watch`, and `ensure-restored` are called by the lifecycle wrappers. Add `--json` for one JSON object. Add `--yes` with `--apply` to skip the prompt. Agent ids are `codex`, `claude`, `kiro`, `grok`, `kimi`, `opencode`, `gemini`, `cursor`, and `devin`.

`npx --yes` only approves npm's temporary package download. This tool asks again through `--apply`.

### Choosing `--older-than`

| Value             | Use it for                                                  |
| ----------------- | ----------------------------------------------------------- |
| `12h`             | A short cleanup window                                      |
| `1d`              | Skip roughly today's active work                            |
| `7d`              | The default setup policy                                    |
| `30d`             | A conservative archive pass                                 |
| `--max --dry-run` | Preview of every archive-mode session. Never with `--apply` |

### Lifecycle

Lifecycle is off until you enable it. Once on, packed sessions come back when an agent opens them.

```sh
npx --yes agent-session-pack lifecycle enable --json
export PATH="$HOME/.agent-session-pack/bin:$PATH"
npx --yes agent-session-pack open --provider grok SESSION_ID --json
npx --yes agent-session-pack maintain --apply --yes --json
```

The wrappers (`codex`, `claude`, `grok`, and the other archive-mode agents) run `preflight` on the session ids in the command line, then `watch` while the agent runs. Packed sessions leave tiny stubs so they stay listable. When the agent opens a stub, `watch` restores the full session. `maintain` re-packs sessions older than `coldAfter` (default `7d`). There is no daemon. `lifecycle disable` removes the wrappers.

## How it works

**Archive** means sessions can be packed into the vault and restored. **Backup-only** means the agent is listed, but its native store is never changed. Cursor discovery currently returns no sessions. Grok and Kimi sessions are whole folders, so they are packed and restored as whole folders.

| Agent       | Mode        | Session store                                      |
| ----------- | ----------- | -------------------------------------------------- |
| Codex       | Archive     | `~/.codex/sessions`                                |
| Claude Code | Archive     | `~/.claude/projects`                               |
| Kiro        | Archive     | `~/.kiro/sessions`                                 |
| Grok        | Archive     | `~/.grok/sessions` (whole session folders)         |
| Kimi Code   | Archive     | `~/.kimi-code/sessions` (whole session folders)    |
| OpenCode    | Archive     | `~/.local/share/opencode`, `~/.opencode`           |
| Gemini CLI  | Archive     | `~/.gemini`, `~/.gemini/tmp`                       |
| Cursor      | Backup-only | `~/Library/Application Support/Cursor`             |
| Devin       | Backup-only | `~/.local/share/devin/cli` (session metadata only) |

### Measured on one machine

One machine's real session history, not a universal benchmark. Run `check` to measure yours. It only works on copies.

| Agent                | Before  | After  | Saved |
| -------------------- | ------- | ------ | ----- |
| Codex                | 2.22 GB | 782 MB | 65.6% |
| Claude Code          | 2.10 GB | 457 MB | 78.7% |
| Kiro                 | 1.95 GB | 190 MB | 90.5% |
| Cursor (backup copy) | 7.27 GB | 957 MB | 87.1% |
| Total                | 13.5 GB | 2.3 GB | ~83%  |

## Status and scope

Active. It archives cold local session files and verifies byte-exact restore. It does not summarize, rewrite, or truncate a conversation, and nothing runs in the background.

`check` and `savings` work on copies only. `pack` is a dry-run unless you pass `--apply`. `pack --max --apply` is refused. Apply writes the archive, restores it, checks SHA-256 equality, writes a manifest, and only then removes the original. `unpack --apply` skips any live file that changed. Cursor and Devin stores are never changed.

## Help

This is not context compaction. It uses lossless compression and verifies byte-exact restore.

Agents can resume a packed session after `restore` or `open`, or after `lifecycle enable` so it happens when the agent opens the stub.

```sh
npx --yes agent-session-pack pack --all-providers --older-than 1d --apply
```

That packs sessions older than a day and skips today's work.

It does not read credentials or upload sessions. For Devin it reads session metadata from the local SQLite database. Archives live in `~/.agent-session-pack`: one `.zst` file and one JSON manifest per session, with the original path and SHA-256.

Questions and bugs go to the [issue tracker](https://github.com/YosefHayim/agent-session-pack/issues).

## Development

The published command installs with npm, Yarn, or pnpm. The commands below are for working in this repository, from the repo root, with [Node.js](https://nodejs.org/) 22 and [pnpm](https://pnpm.io/):

```sh
pnpm install
pnpm check
```

`pnpm check` lints, typechecks, tests, then builds. Tests never read or change your real session folders. Instructions for coding agents are in [AGENTS.md](AGENTS.md).

## License

MIT.
