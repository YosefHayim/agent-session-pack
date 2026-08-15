# LANGUAGE.md — agent-session-pack

The human↔agent glossary: names only. Use these exact terms in code, comments,
commits, and docs; avoid the listed aliases. Orientation lives in `CONTEXT.md`.

## Terms

**vault**
Agent Session Pack storage under `~/.agent-session-pack`.
_Avoid_: cache, memory.

**store**
Provider local session root, such as `~/.codex/sessions`.
_Avoid_: folder, source.

**session**
One provider conversation or log file.
_Avoid_: conversation in code paths.

**archive**
Compressed content-addressed `.zst` object.
_Avoid_: backup except Cursor mode.

**manifest**
Metadata required to restore a session.
_Avoid_: config.

**tombstone**
Metadata proving an original was removed after verified archive.
_Avoid_: delete marker.

**cold**
Eligible for packing by age and policy.
_Avoid_: old.

**live**
Native original still exists.
_Avoid_: active.

**archived**
Packed and original removed after verification.
_Avoid_: compressed.

**restored**
Native file was restored from an archive.
_Avoid_: unpacked.

**pinned**
Excluded from packing.
_Avoid_: ignored.

**quarantined**
Metadata retained for explicit prune/recovery.
_Avoid_: deleted.
