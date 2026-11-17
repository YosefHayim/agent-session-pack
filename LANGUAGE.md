# LANGUAGE.md

**vault**
Agent Session Pack storage under `~/.agent-session-pack`.
_Avoid_: cache, memory

**store**
A provider's local session root, such as `~/.codex/sessions`.
_Avoid_: folder, source

**session**
One provider conversation: a file, or a whole directory for Grok and Kimi.
_Avoid_: conversation in code paths

**archive**
A compressed, content-addressed `.zst` object in the vault.
_Avoid_: backup, except in Cursor and Devin backup-only mode

**manifest**
The metadata needed to restore a session byte for byte.
_Avoid_: config

**stub**
A tiny file left in place of a packed session, so the agent still lists it; opening it restores the session.
_Avoid_: placeholder, marker

**tombstone**
Metadata proving an original was removed after a verified archive.
_Avoid_: delete marker

**cold**
Old enough, by age and policy, to be packed.
_Avoid_: old

**live**
The native original still exists.
_Avoid_: active

**archived**
Packed, with the original removed after verification.
_Avoid_: compressed

**restored**
The native session was written back from its archive.
_Avoid_: unpacked

**pinned**
Excluded from packing.
_Avoid_: ignored

**quarantined**
Metadata kept for an explicit prune or recovery.
_Avoid_: deleted

## Swaps

CLI flags, `--json` keys and manifest fields keep their names; these swaps are for code names.

| Avoid in code                         | Use                                            |
| ------------------------------------- | ---------------------------------------------- |
| source path (a session)               | `sessionPath`                                  |
| source path (what a compressor reads) | `uncompressedPath`                             |
| content (fixture session text)        | `sessionJsonl`                                 |
| output (a process result)             | `stdout`                                       |
| machine output requested              | `isMachineReadableRequested`                   |
| payload                               | the report it holds, such as `preflightReport` |
| `catch (cause)`                       | `catch (error)`                                |
