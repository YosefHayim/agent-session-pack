# Round-Trip Example

This folder contains small synthetic sessions that demonstrate the safety invariant:

```text
sha256(before/*.jsonl) == sha256(after/*.jsonl)
```

The `.zst` files are real zstd archives produced from the matching `before/` files. The `after/` files are restored copies. The provider names are representative only; these fixtures are not real private sessions.

Run:

```bash
zstd -d -f examples/roundtrip/archives/codex-session.jsonl.zst -o /tmp/codex-session.jsonl
shasum -a 256 examples/roundtrip/before/codex-session.jsonl /tmp/codex-session.jsonl
```
