# LANGUAGE.md

| Term | Definition | Avoid |
| --- | --- | --- |
| vault | Agent Recall storage under `~/.agent-recall`. | cache, memory |
| store | Provider local session root, such as `~/.codex/sessions`. | folder, source |
| session | One provider conversation or log file. | conversation in code paths |
| archive | Compressed content-addressed `.zst` object. | backup except Cursor mode |
| manifest | Metadata required to restore a session. | config |
| tombstone | Metadata proving an original was removed after verified archive. | delete marker |
| cold | Eligible for packing by age and policy. | old |
| live | Native original still exists. | active |
| archived | Packed and original removed after verification. | compressed |
| restored | Native file was restored from an archive. | unpacked |
| pinned | Excluded from packing. | ignored |
| quarantined | Metadata retained for explicit prune/recovery. | deleted |
