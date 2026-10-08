<div dir="rtl">

<p align="center">
  <a href="https://github.com/YosefHayim/agent-session-pack"><img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/hero.png" alt="Agent Session Pack: דחיסת היסטוריית סשנים מקומית של סוכני קוד לארכיון zstd מאומת ושחזור מדויק ברמת הבייט" width="820" /></a>
</p>

<p align="center">
  <strong>אחסון קר לסשנים מקומיים של סוכני קוד מבוססי AI. מקטין את נפח ההיסטוריה של Codex, Claude Code, Kiro, Grok, Kimi, OpenCode ו־Gemini CLI בדיסק, ומחזיר כל בייט בשחזור.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/v/agent-session-pack?logo=npm&color=cb3837" alt="גרסת npm" /></a>
  <a href="https://www.npmjs.com/package/agent-session-pack"><img src="https://img.shields.io/npm/dm/agent-session-pack?logo=npm&color=cb3837" alt="הורדות npm בחודש" /></a>
  <a href="https://github.com/YosefHayim/agent-session-pack/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/YosefHayim/agent-session-pack/ci.yml?branch=main&logo=github&label=CI" alt="סטטוס CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/npm/l/agent-session-pack?color=blue" alt="רישיון MIT" /></a>
  <img src="https://img.shields.io/node/v/agent-session-pack?logo=node.js&color=339933" alt="גרסת Node.js נדרשת" />
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ja.md">日本語</a> · <strong>עברית</strong> · <a href="README.es.md">Español</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

---

**Agent Session Pack** הוא כלי CLI מבוסס [Node.js](https://nodejs.org/en) למפתחים ולסוכני קוד שהיסטוריית הסשנים המקומית שלהם גדלה. הכלי מוצא את תיקיות הסשנים של Codex, Claude Code, Kiro, Grok, Kimi Code, OpenCode, Gemini CLI, Cursor ו־Devin, מוכיח דחיסה ללא אובדן עם [Zstandard](https://facebook.github.io/zstd/) על עותקים, ואורז סשנים קרים לכספת מקומית רק כשמבקשים ממנו. לפני שקובץ מקורי נמחק, הארכיון משוחזר ו־hash מסוג SHA-256 מושווה.

בלי שירות רקע, בלי סנכרון לענן, בלי סיכומים. הסשנים לא יוצאים מהמחשב.

> התיעוד המלא נמצא ב־[README.md](README.md) באנגלית.

## יכולות

- **9 סוכני קוד** - Codex, Claude Code, Kiro, Grok, Kimi Code, OpenCode ו־Gemini CLI נארזים ומשוחזרים. Cursor ו־Devin במצב גיבוי בלבד.
- **הוכחה לפני שינוי** - `check` מעתיק סשן אחד לכל סוכן, דוחס, משחזר ומשווה hash. הקבצים האמיתיים לא נוגעים.
- **שחזור מדויק ברמת הבייט** - כל ארכיון משוחזר ונבדק ב־SHA-256 לפני מחיקת המקור.
- **הרצת ניסיון כברירת מחדל** - שום דבר לא נמחק בלי `--apply`, ו־`--apply` מבקש אישור אלא אם מעבירים `--yes`.
- **סינון סשנים קרים** - `--older-than 7d` (או `12h`, `1d`, `2w`, `30d`) שומר על העבודה הפעילה.
- **מותאם לסוכנים** - `guide --json` מדפיס מפת פקודות בטוחה, ולפקודות העיקריות יש פלט `--json` יציב.

## סוכנים נתמכים

| סוכן | מצב | תיקיית סשנים |
| --- | --- | --- |
| Codex | ארכיון | `~/.codex/sessions` |
| Claude Code | ארכיון | `~/.claude/projects` |
| Kiro | ארכיון | `~/.kiro/sessions` |
| Grok | ארכיון | `~/.grok/sessions` (תיקיות שלמות) |
| Kimi Code | ארכיון | `~/.kimi-code/sessions` (תיקיות שלמות) |
| OpenCode | ארכיון | `~/.local/share/opencode`, `~/.opencode` |
| Gemini CLI | ארכיון | `~/.gemini`, `~/.gemini/tmp` |
| Cursor | גיבוי בלבד | `~/Library/Application Support/Cursor` |
| Devin | גיבוי בלבד | `~/.local/share/devin/cli` (קורא רק מטא־דאטה מ־`sessions.db`) |

## מדדים

<p align="center">
  <img src="https://raw.githubusercontent.com/YosefHayim/agent-session-pack/main/assets/benchmarks.svg" alt="נפח הסשנים לפני ואחרי אריזה במחשב אחד" width="820" />
</p>

| סוכן | לפני | אחרי | חיסכון |
| --- | ---: | ---: | ---: |
| Codex | 2.22 GB | 782 MB | **65.6%** |
| Claude Code | 2.10 GB | 457 MB | **78.7%** |
| Kiro | 1.95 GB | 190 MB | **90.5%** |
| Cursor (עותק גיבוי) | 7.27 GB | 957 MB | **87.1%** |
| **סך הכול** | **13.5 GB** | **2.3 GB** | **כ־83%** |

אלה נתונים אמיתיים ממחשב אחד, לא מדד כללי. כדי למדוד אצלכם הריצו `npx --yes agent-session-pack check` (עובד על עותקים בלבד).

## התחלה מהירה

דרישות: [Node.js](https://nodejs.org/en) 20 ומעלה, [`zstd`](https://facebook.github.io/zstd/) ב־`PATH`, ו־`sqlite3` רק אם משתמשים ב־Devin.

</div>

```bash
# 1. Prove savings on copies (real files untouched)
npx --yes agent-session-pack check

# 2. Preview what would be packed
npx --yes agent-session-pack pack --all-providers --older-than 7d --dry-run

# 3. Pack cold sessions (originals removed only after verification)
npx --yes agent-session-pack pack --all-providers --older-than 7d --apply

# 4. Restore when needed
npx --yes agent-session-pack unpack --all-providers --apply
npx --yes agent-session-pack restore SESSION_ID_OR_NAME
```

<div dir="rtl">

הרצה של `npx --yes agent-session-pack` בלי ארגומנטים פותחת תפריט מודרך בטרמינל.

## מודל הבטיחות

- `check` ו־`savings` עובדים על עותקים בלבד.
- `pack --all-providers` הוא הרצת ניסיון אלא אם מוסיפים `--apply`.
- `pack --apply` מבקש אישור בטרמינל אלא אם מוסיפים `--yes`.
- `pack --max --apply` נדחה.
- בהחלה: כתיבת ארכיון, שחזור, השוואת SHA-256, כתיבת מניפסט, ורק אז מחיקת המקור.
- `unpack --apply` מדלג על קבצים חיים ששונו במקום לדרוס אותם.
- Cursor ו־Devin במצב גיבוי בלבד: התיקיות המקוריות שלהם לא משתנות.

## מחזור חיים: שחזור אוטומטי בפתיחה

מחזור החיים כבוי עד שמפעילים אותו. `lifecycle enable` מתקין עטיפות לסוכנים, וסשן ארוז משוחזר אוטומטית כשפותחים אותו. `maintain --apply` אורז מחדש סשנים שהתקררו שוב. פרטים מלאים ב־[README באנגלית](README.md#lifecycle-auto-restore-on-launch).

## שאלות נפוצות

<details>
<summary><strong>האם זה סיכום או דחיסת הקשר?</strong></summary>

לא. הכלי לא מסכם, לא משכתב ולא חותך שיחות. הוא משתמש בדחיסה ללא אובדן ומוודא שחזור מדויק ברמת הבייט.
</details>

<details>
<summary><strong>האם הכלי קורא פרטי התחברות או מעלה סשנים?</strong></summary>

לא. הוא סורק תיקיות מקומיות וכותב ארכיונים מקומיים בלבד. עבור Devin הוא קורא מטא־דאטה ממסד SQLite מקומי ולא קורא פרטי התחברות.
</details>

<details>
<summary><strong>במה זה שונה ממחיקת קבצי סשנים ישנים?</strong></summary>

מחיקה היא חד־כיוונית. Agent Session Pack כותב ארכיון, מוכיח שהוא משחזר את הבייטים המקוריים במדויק, כותב מניפסט, ורק אז מוחק את המקור.
</details>

## רישיון

MIT - ראו [LICENSE](LICENSE).

---

<div align="center">

<a href="https://www.buymeacoffee.com/yosefhayim" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" /></a>

<br /><br />

**[לתמיכה בפרויקט](https://www.buymeacoffee.com/yosefhayim)** · נוצר על ידי [Yosef Hayim Sabag](https://github.com/YosefHayim)

</div>

</div>
