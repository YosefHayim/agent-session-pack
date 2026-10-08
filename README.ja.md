<p align="center">
  <a href="https://github.com/YosefHayim/agent-session-pack"><img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack: ローカルの AI コーディングエージェントのセッション履歴を検証済みの zstd アーカイブに圧縮し、バイト単位で完全に復元" width="820" /></a>
</p>

<p align="center">
  <strong>ローカル AI コーディングエージェントのセッションのためのコールドストレージ。Codex、Claude Code、Kiro、Grok、Kimi、OpenCode、Gemini CLI の履歴のディスク使用量を減らし、復元時には 1 バイトも失いません。</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/v/agent-session-pack?logo=npm&color=cb3837" alt="npm バージョン" /></a>
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/dm/agent-session-pack?logo=npm&color=cb3837" alt="npm 月間ダウンロード数" /></a>
  <a href="https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/agent-session-pack/ci.yml?branch=main&logo=github&label=CI" alt="CI ステータス" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/agent-session-pack?color=blue" alt="MIT ライセンス" /></a>
  <img src="https://img.shields.io/node/v/agent-session-pack?logo=node.js&color=339933" alt="必要な Node.js バージョン" />
</p>

<p align="center">
  <a href="README.md">English</a> · <strong>日本語</strong> · <a href="README.he.md">עברית</a> · <a href="README.es.md">Español</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

**Agent Session Pack** は、ローカルのセッション履歴が大きくなった開発者とコーディングエージェントのための [Node.js](https://nodejs.org/en) CLI です。Codex、Claude Code、Kiro、Grok、Kimi Code、OpenCode、Gemini CLI、Cursor、Devin のセッション保存先を見つけ、コピー上で [Zstandard](https://facebook.github.io/zstd/) による可逆圧縮を証明し、指示したときだけコールドセッションをローカルの保管庫に圧縮します。元ファイルを削除する前に、必ずアーカイブを復元して SHA-256 ハッシュを比較します。

デーモンなし、クラウド同期なし、要約なし。セッションがマシンの外に出ることはありません。

> 完全なドキュメントは英語版の [README.md](README.md) にあります。

## 特長

- **9 種類のエージェントに対応** - Codex、Claude Code、Kiro、Grok、Kimi Code、OpenCode、Gemini CLI は圧縮と復元が可能。Cursor と Devin はバックアップ専用です。
- **変更前に証明** - `check` は各エージェントのセッションを 1 つコピーし、圧縮、復元、ハッシュ比較を行います。実ファイルには触れません。
- **バイト単位で完全な復元** - 元ファイルを削除する前に、すべてのアーカイブを復元して SHA-256 で検証します。
- **デフォルトはドライラン** - `--apply` なしでは何も削除されず、`--yes` がなければ確認を求めます。
- **コールドセッションの絞り込み** - `--older-than 7d`（`12h`、`1d`、`2w`、`30d` も可）で作業中のセッションを守ります。
- **エージェント向け設計** - `guide --json` が安全なコマンド一覧を出力し、主要なコマンドが安定した `--json` 出力を持ちます。

## 対応エージェント

| エージェント | モード | セッション保存先 |
| --- | --- | --- |
| Codex | アーカイブ | `~/.codex/sessions` |
| Claude Code | アーカイブ | `~/.claude/projects` |
| Kiro | アーカイブ | `~/.kiro/sessions` |
| Grok | アーカイブ | `~/.grok/sessions`（フォルダー単位） |
| Kimi Code | アーカイブ | `~/.kimi-code/sessions`（フォルダー単位） |
| OpenCode | アーカイブ | `~/.local/share/opencode`、`~/.opencode` |
| Gemini CLI | アーカイブ | `~/.gemini`、`~/.gemini/tmp` |
| Cursor | バックアップ専用 | `~/Library/Application Support/Cursor` |
| Devin | バックアップ専用 | `~/.local/share/devin/cli`（`sessions.db` のメタデータのみ読み取り） |

## ベンチマーク

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/benchmarks.svg" alt="1 台のマシンでの圧縮前後のセッション容量" width="820" />
</p>

| エージェント | 圧縮前 | 圧縮後 | 削減率 |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | **65.6%** |
| Claude Code | 2.10 GB | 457 MB | **78.7%** |
| Kiro | 1.95 GB | 190 MB | **90.5%** |
| Cursor（バックアップコピー） | 7.27 GB | 957 MB | **87.1%** |
| **合計** | **13.5 GB** | **2.3 GB** | **約 83%** |

1 台のマシンの実データであり、普遍的なベンチマークではありません。自分の環境では `npx --yes agent-session-pack check` で測定できます（コピーのみを使用）。

## クイックスタート

必要なもの: [Node.js](https://nodejs.org/en) 20 以上、`PATH` 上の [`zstd`](https://facebook.github.io/zstd/)、Devin を使う場合のみ `sqlite3`。

```bash
# 1. コピー上で削減量を証明（実ファイルは変更しない）
npx --yes agent-session-pack check

# 2. 圧縮対象をプレビュー
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run

# 3. コールドセッションを圧縮（検証後に元ファイルを削除）
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply

# 4. 必要なときに復元
npx --yes agent-session-pack unpack --all-providers --apply
npx --yes agent-session-pack restore SESSION_ID_OR_NAME
```

引数なしで `npx --yes agent-session-pack` を実行すると、ガイド付きメニューが開きます。

## 安全モデル

- `check` と `savings` はコピーだけを扱います。
- `pack --all-providers` は `--apply` を付けない限りドライランです。
- `pack --apply` は、`--yes` がなければターミナルで確認を求めます。
- `pack --max --apply` は拒否されます。
- 適用時は、アーカイブ作成、復元、SHA-256 比較、マニフェスト書き込みの後にのみ元ファイルを削除します。
- `unpack --apply` は、変更されたライブファイルを上書きせずにスキップします。
- Cursor と Devin はバックアップ専用で、ネイティブの保存先は変更されません。

## ライフサイクル: 起動時の自動復元

ライフサイクルは有効にするまでオフです。`lifecycle enable` でエージェント用のラッパーがインストールされ、圧縮済みセッションを開くと自動で復元されます。`maintain --apply` は再びコールドになったセッションを再圧縮します。詳しくは [英語版](README.md#lifecycle-auto-restore-on-launch) を参照してください。

## よくある質問

<details>
<summary><strong>これはコンテキストの要約や圧縮ですか？</strong></summary>

いいえ。会話を要約、書き換え、切り詰めることはありません。可逆圧縮を使い、バイト単位で完全に復元できることを検証します。
</details>

<details>
<summary><strong>認証情報を読んだり、セッションをアップロードしたりしますか？</strong></summary>

いいえ。ローカルの保存先をスキャンし、ローカルにアーカイブを書き込むだけです。Devin ではローカルの SQLite からメタデータを読み取りますが、認証情報は読みません。
</details>

<details>
<summary><strong>古いセッションファイルを削除するのと何が違いますか？</strong></summary>

削除は元に戻せません。Agent Session Pack はアーカイブを作成し、元のバイトを正確に復元できることを証明し、マニフェストを書いてから元ファイルを削除します。
</details>

## ライセンス

MIT - [LICENSE](LICENSE) を参照してください。

---

<div align="center">

<a href="https://www.buymeacoffee.com/yosefhayim" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" /></a>

<br /><br />

**[このプロジェクトを支援する](https://www.buymeacoffee.com/yosefhayim)** · 作者 [Yosef Hayim Sabag](https://github.com/YosefHayim)

</div>
