<p align="center">
  <a href="https://github.com/YosefHayim/agent-session-pack"><img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack：将本地 AI 编程代理会话历史压缩为经过验证的 zstd 归档，并逐字节精确还原" width="820" /></a>
</p>

<p align="center">
  <strong>本地 AI 编程代理会话的冷存储。减少 Codex、Claude Code、Kiro、Grok、Kimi、OpenCode 和 Gemini CLI 历史记录的磁盘占用，还原时一个字节都不丢。</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/v/agent-session-pack?logo=npm&color=cb3837" alt="npm 版本" /></a>
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/dm/agent-session-pack?logo=npm&color=cb3837" alt="npm 每月下载量" /></a>
  <a href="https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/agent-session-pack/ci.yml?branch=main&logo=github&label=CI" alt="CI 状态" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/agent-session-pack?color=blue" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/node/v/agent-session-pack?logo=node.js&color=339933" alt="所需 Node.js 版本" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.he.md">עברית</a> · <a href="README.es.md">Español</a> · <strong>简体中文</strong>
</p>

---

**Agent Session Pack** 是一个 [Node.js](https://nodejs.org/en) CLI，面向本地会话历史越来越大的开发者和编程代理。它会找到 Codex、Claude Code、Kiro、Grok、Kimi Code、OpenCode、Gemini CLI、Cursor 和 Devin 的会话存储位置，先在副本上证明 [Zstandard](https://facebook.github.io/zstd/) 无损压缩的效果，并且只在你明确要求时才把冷会话打包进本地保管库。删除任何原始文件之前，都会先还原归档并比对 SHA-256 哈希。

没有后台进程，没有云同步，没有摘要改写。你的会话永远不会离开你的电脑。

> 完整文档请参阅英文版 [README.md](README.md)。

## 功能

- **支持 9 种编程代理** - Codex、Claude Code、Kiro、Grok、Kimi Code、OpenCode 和 Gemini CLI 可打包和还原；Cursor 和 Devin 仅备份。
- **先证明，再改动** - `check` 为每个代理复制一个会话，压缩、还原并比对哈希。真实文件保持不变。
- **逐字节精确还原** - 每个归档在删除原文件前都会被还原并用 SHA-256 校验。
- **默认试运行** - 没有 `--apply` 不会删除任何内容；除非传入 `--yes`，`--apply` 会先请求确认。
- **冷会话筛选** - `--older-than 7d`（也支持 `12h`、`1d`、`2w`、`30d`）保护正在进行的工作。
- **为代理设计** - `guide --json` 输出安全命令清单，每个命令都有稳定的 `--json` 输出。

## 支持的代理

| 代理 | 模式 | 会话存储位置 |
| --- | --- | --- |
| Codex | 归档 | `~/.codex/sessions` |
| Claude Code | 归档 | `~/.claude/projects` |
| Kiro | 归档 | `~/.kiro/sessions` |
| Grok | 归档 | `~/.grok/sessions`（整个文件夹） |
| Kimi Code | 归档 | `~/.kimi-code/sessions`（整个文件夹） |
| OpenCode | 归档 | `~/.local/share/opencode`、`~/.opencode` |
| Gemini CLI | 归档 | `~/.gemini`、`~/.gemini/tmp` |
| Cursor | 仅备份 | `~/Library/Application Support/Cursor` |
| Devin | 仅备份 | `~/.local/share/devin/cli`（只读取 `sessions.db` 元数据） |

## 基准数据

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/benchmarks.svg" alt="一台机器上打包前后的会话占用" width="820" />
</p>

| 代理 | 打包前 | 打包后 | 节省 |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | **65.6%** |
| Claude Code | 2.10 GB | 457 MB | **78.7%** |
| Kiro | 1.95 GB | 190 MB | **90.5%** |
| Cursor（备份副本） | 7.27 GB | 957 MB | **87.1%** |
| **合计** | **13.5 GB** | **2.3 GB** | **约 83%** |

这是一台机器上的真实数据，不是通用基准。用 `npx --yes agent-session-pack check` 测量你自己的数据（只处理副本）。

## 快速开始

环境要求：[Node.js](https://nodejs.org/en) 20 或更高版本，`PATH` 中有 [`zstd`](https://facebook.github.io/zstd/)，仅在使用 Devin 时需要 `sqlite3`。

```bash
# 1. 在副本上证明节省空间（不改动真实文件）
npx --yes agent-session-pack check

# 2. 预览将要打包的会话
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run

# 3. 打包冷会话（验证通过后才删除原文件）
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply

# 4. 需要时还原
npx --yes agent-session-pack unpack --all-providers --apply
npx --yes agent-session-pack restore <会话 ID 或名称>
```

在终端中不带参数运行 `npx --yes agent-session-pack` 会打开引导菜单。

## 安全模型

- `check` 和 `savings` 只处理副本。
- 除非加上 `--apply`，`pack --all-providers` 都是试运行。
- 除非加上 `--yes`，`pack --apply` 会在终端中请求确认。
- `pack --max --apply` 会被拒绝。
- 执行时依次写入归档、还原、比对 SHA-256、写入清单，最后才删除原文件。
- `unpack --apply` 会跳过已被修改的现有文件，而不是覆盖它们。
- Cursor 和 Devin 仅备份：它们的原生存储永远不会被改动。

## 生命周期：启动时自动还原

生命周期功能默认关闭。`lifecycle enable` 会为代理安装包装脚本，打开已打包的会话时会自动还原。`maintain --apply` 会重新打包再次变冷的会话。详情见[英文版 README](README.md#lifecycle-auto-restore-on-launch)。

## 常见问题

<details>
<summary><strong>这是上下文压缩或摘要吗？</strong></summary>

不是。它不会摘要、改写或截断任何对话，只使用无损压缩，并验证逐字节精确还原。
</details>

<details>
<summary><strong>它会读取凭据或上传会话吗？</strong></summary>

不会。它只扫描本地存储并写入本地归档。对于 Devin，它从本地 SQLite 数据库读取元数据，从不读取凭据。
</details>

<details>
<summary><strong>这和直接删除旧会话文件有什么区别？</strong></summary>

删除是不可逆的。Agent Session Pack 会写入归档，证明它能精确还原原始字节，写入清单，然后才删除原文件。
</details>

## 许可证

MIT - 参见 [LICENSE](LICENSE)。

---

<div align="center">

<a href="https://www.buymeacoffee.com/yosefhayim" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" /></a>

<br /><br />

**[支持这个项目](https://www.buymeacoffee.com/yosefhayim)** · 作者 [Yosef Hayim Sabag](https://github.com/YosefHayim)

</div>
