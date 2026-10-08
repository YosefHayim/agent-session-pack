# Hello World

The smallest proof of the safety invariant: a packed session restores to the exact same bytes.

```text
sha256(before/*.jsonl) == sha256(after/*.jsonl)
```

## What is here

| Path | Contents |
| --- | --- |
| `before/` | Three tiny synthetic sessions, one each for Codex, Claude Code, and Kiro. |
| `archives/` | Real `zstd -9` archives of the matching `before/` files. |
| `after/` | The files restored from `archives/`. |
| `evidence.json` | Sizes, savings, and SHA-256 hashes for every file. |

These fixtures are not real private sessions. The provider names only show the shape.

## Run it

From the repo root, with [`zstd`](https://facebook.github.io/zstd/) installed:

```bash
for name in codex claude kiro; do
  shasum -a 256 < examples/hello-world/before/$name-session.jsonl
  zstd -d -c examples/hello-world/archives/$name-session.jsonl.zst | shasum -a 256
done
```

Each pair of lines prints the same hash. The archive restores the original bytes exactly.

To try the same proof on your own sessions, without touching them:

```bash
npx --yes agent-session-pack check
```
