<p align="center">
  <a href="https://github.com/YosefHayim/agent-session-pack"><img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack: comprime el historial local de sesiones de agentes de programación con IA en un archivo zstd verificado y lo restaura byte a byte" width="820" /></a>
</p>

<p align="center">
  <strong>Almacenamiento en frío para sesiones locales de agentes de programación con IA. Reduce en disco el historial de Codex, Claude Code, Kiro, Grok, Kimi, OpenCode y Gemini CLI, y recupera cada byte al restaurar.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/v/agent-session-pack?logo=npm&color=cb3837" alt="versión en npm" /></a>
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/dm/agent-session-pack?logo=npm&color=cb3837" alt="descargas mensuales en npm" /></a>
  <a href="https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/agent-session-pack/ci.yml?branch=main&logo=github&label=CI" alt="estado de CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/agent-session-pack?color=blue" alt="licencia MIT" /></a>
  <img src="https://img.shields.io/node/v/agent-session-pack?logo=node.js&color=339933" alt="versión de Node.js requerida" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <a href="README.he.md">עברית</a> · <strong>Español</strong> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

**Agent Session Pack** es una CLI de [Node.js](https://nodejs.org/en) para desarrolladores y agentes de programación cuyo historial local de sesiones ha crecido demasiado. Encuentra los almacenes de sesiones de Codex, Claude Code, Kiro, Grok, Kimi Code, OpenCode, Gemini CLI, Cursor y Devin, demuestra la compresión sin pérdida con [Zstandard](https://facebook.github.io/zstd/) sobre copias y empaqueta las sesiones frías en una bóveda local solo cuando se lo pides. Antes de borrar un archivo original, siempre restaura el archivo comprimido y compara los hashes SHA-256.

Sin demonio, sin sincronización en la nube, sin resúmenes. Tus sesiones nunca salen de tu máquina.

> La documentación completa está en inglés en [README.md](README.md).

## Características

- **9 agentes de programación** - Codex, Claude Code, Kiro, Grok, Kimi Code, OpenCode y Gemini CLI se empaquetan y restauran; Cursor y Devin son solo de respaldo.
- **Prueba antes de cambiar** - `check` copia una sesión por agente, la comprime, la restaura y compara hashes. Los archivos reales no se tocan.
- **Restauración byte a byte** - cada archivo comprimido se restaura y se verifica con SHA-256 antes de borrar el original.
- **Simulación por defecto** - nada se borra sin `--apply`, y `--apply` pide confirmación salvo que pases `--yes`.
- **Filtro de sesiones frías** - `--older-than 7d` (o `12h`, `1d`, `2w`, `30d`) protege tu trabajo activo.
- **Pensado para agentes** - `guide --json` muestra el mapa de comandos seguros y los comandos principales tienen salida `--json` estable.

## Agentes compatibles

| Agente | Modo | Almacén de sesiones |
| --- | --- | --- |
| Codex | Archivo | `~/.codex/sessions` |
| Claude Code | Archivo | `~/.claude/projects` |
| Kiro | Archivo | `~/.kiro/sessions` |
| Grok | Archivo | `~/.grok/sessions` (carpetas completas) |
| Kimi Code | Archivo | `~/.kimi-code/sessions` (carpetas completas) |
| OpenCode | Archivo | `~/.local/share/opencode`, `~/.opencode` |
| Gemini CLI | Archivo | `~/.gemini`, `~/.gemini/tmp` |
| Cursor | Solo respaldo | `~/Library/Application Support/Cursor` |
| Devin | Solo respaldo | `~/.local/share/devin/cli` (solo lee metadatos de `sessions.db`) |

## Resultados

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/benchmarks.svg" alt="Tamaño de las sesiones antes y después de empaquetar en una máquina" width="820" />
</p>

| Agente | Antes | Después | Ahorro |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | **65.6%** |
| Claude Code | 2.10 GB | 457 MB | **78.7%** |
| Kiro | 1.95 GB | 190 MB | **90.5%** |
| Cursor (copia de respaldo) | 7.27 GB | 957 MB | **87.1%** |
| **Total** | **13.5 GB** | **2.3 GB** | **~83%** |

Son datos reales de una sola máquina, no un benchmark universal. Mide los tuyos con `npx --yes agent-session-pack check` (solo trabaja con copias).

## Inicio rápido

Requisitos: [Node.js](https://nodejs.org/en) 20 o superior, [`zstd`](https://facebook.github.io/zstd/) en tu `PATH` y `sqlite3` solo si usas Devin.

```bash
# 1. Demuestra el ahorro sobre copias (no toca los archivos reales)
npx --yes agent-session-pack check

# 2. Previsualiza qué se empaquetaría
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run

# 3. Empaqueta las sesiones frías (borra originales solo tras verificar)
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply

# 4. Restaura cuando lo necesites
npx --yes agent-session-pack unpack --all-providers --apply
npx --yes agent-session-pack restore SESSION_ID_OR_NAME
```

Ejecuta `npx --yes agent-session-pack` sin argumentos para abrir un menú guiado en la terminal.

## Modelo de seguridad

- `check` y `savings` solo trabajan con copias.
- `pack --all-providers` es una simulación salvo que añadas `--apply`.
- `pack --apply` pide confirmación en la terminal salvo que añadas `--yes`.
- `pack --max --apply` se rechaza.
- Al aplicar: escribe el archivo, lo restaura, compara SHA-256, escribe un manifiesto y solo entonces borra el original.
- `unpack --apply` omite los archivos vivos que cambiaron en lugar de sobrescribirlos.
- Cursor y Devin son solo de respaldo: sus almacenes nativos nunca se modifican.

## Ciclo de vida: restauración automática al abrir

El ciclo de vida está desactivado hasta que lo actives. `lifecycle enable` instala envoltorios para los agentes, y una sesión empaquetada se restaura sola cuando la abres. `maintain --apply` vuelve a empaquetar las sesiones que se enfriaron otra vez. Más detalles en el [README en inglés](README.md#lifecycle-auto-restore-on-launch).

## Preguntas frecuentes

<details>
<summary><strong>¿Es compactación o resumen del contexto?</strong></summary>

No. Nunca resume, reescribe ni recorta una conversación. Usa compresión sin pérdida y verifica la restauración byte a byte.
</details>

<details>
<summary><strong>¿Lee credenciales o sube sesiones?</strong></summary>

No. Escanea almacenes locales y escribe archivos locales. Para Devin lee metadatos de la base SQLite local y nunca lee credenciales.
</details>

<details>
<summary><strong>¿En qué se diferencia de borrar sesiones antiguas?</strong></summary>

Borrar no tiene vuelta atrás. Agent Session Pack escribe un archivo, demuestra que restaura exactamente los bytes originales, escribe un manifiesto y solo entonces borra el original.
</details>

## Licencia

MIT - consulta [LICENSE](LICENSE).

---

<div align="center">

<a href="https://www.buymeacoffee.com/yosefhayim" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" /></a>

<br /><br />

**[Apoya este proyecto](https://www.buymeacoffee.com/yosefhayim)** · Creado por [Yosef Hayim Sabag](https://github.com/YosefHayim)

</div>
