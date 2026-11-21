import { constants as bufferConstants } from 'node:buffer';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  claudeCodeProvider,
  codexProvider,
  collectJsonlSessions,
  devinProvider,
  grokProvider,
  kimiProvider,
  measureDirectorySession,
  readProviderId,
  readSessionIdFromPath,
  readSessionTitle,
  slugifyTitle,
} from './providers.js';

describe('readProviderId', () => {
  it('returns null for an unknown provider word', () => {
    expect(readProviderId('not-a-provider')).toBeNull();
  });

  it('returns the provider id for a known word', () => {
    expect(readProviderId('codex')).toBe('codex');
    expect(readProviderId('devin')).toBe('devin');
  });
});

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-session-discovery-'));
}

describe('sessionDiscovery', () => {
  it('slugifies titles and falls back for empty or punctuation-only input', () => {
    expect(slugifyTitle('Fix Login Bug')).toBe('fix-login-bug');
    expect(slugifyTitle('  Multi   Space  Title  ')).toBe('multi-space-title');
    expect(slugifyTitle('!!!')).toBe('untitled-session');
    expect(slugifyTitle('')).toBe('untitled-session');
  });

  it('extracts UUID session ids when present and otherwise uses the basename', () => {
    expect(
      readSessionIdFromPath(
        '/sessions/rollout-2026-05-04T03-05-27-019df04d-dc23-7751-bcd1-d03b60116746.jsonl',
      ),
    ).toBe('019df04d-dc23-7751-bcd1-d03b60116746');
    expect(readSessionIdFromPath('/sessions/plain-session.jsonl')).toBe('plain-session');
    expect(readSessionIdFromPath('/sessions/no-extension')).toBe('no-extension');
  });

  it('collects nested JSONL files and honors exclude path parts', async () => {
    const workspace = await createWorkspace();
    const nested = join(workspace, '2026', '07', '01');
    const excluded = join(workspace, 'subagents');
    const keepPath = join(nested, 'keep.jsonl');
    const skipPath = join(excluded, 'skip.jsonl');

    await mkdir(nested, { recursive: true });
    await mkdir(excluded, { recursive: true });
    await writeFile(keepPath, '{"type":"user","text":"keep"}\n');
    await writeFile(skipPath, '{"type":"user","text":"skip"}\n');
    await writeFile(join(nested, 'notes.txt'), 'ignore');

    const files = await collectJsonlSessions(workspace, {
      excludePathParts: ['subagents'],
    });

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: keepPath,
    });
    expect(files[0].sizeBytes).toBeGreaterThan(0);
    expect(files[0].modifiedAt).toBeInstanceOf(Date);
  });

  it('throws when the collect root is missing', async () => {
    const workspace = await createWorkspace();
    const missingRoot = join(workspace, 'missing-root');

    await expect(
      collectJsonlSessions(missingRoot, {
        excludePathParts: [],
      }),
    ).rejects.toThrow(missingRoot);
  });

  it('measures directory session size and newest mtime', async () => {
    const workspace = await createWorkspace();
    const sessionPath = join(workspace, 'session-dir');
    await mkdir(join(sessionPath, 'nested'), { recursive: true });
    await writeFile(join(sessionPath, 'summary.json'), '{"title":"dir"}\n');
    await writeFile(join(sessionPath, 'nested', 'updates.jsonl'), '{"type":"user","text":"hi"}\n');

    const measuredSession = await measureDirectorySession(sessionPath);

    expect(measuredSession.path).toBe(sessionPath);
    expect(measuredSession.sizeBytes).toBeGreaterThan(0);
    expect(measuredSession.modifiedAt).toBeInstanceOf(Date);
  });

  it('reads titles from user text, message content, and falls back to basename', async () => {
    const workspace = await createWorkspace();
    const titleJsonlPath = join(workspace, 'text-title.jsonl');
    const messagePath = join(workspace, 'message-title.jsonl');
    const fallbackPath = join(workspace, 'fallback-title.jsonl');

    await writeFile(
      titleJsonlPath,
      '{"type":"assistant","text":"no"}\n{"type":"user","text":"Plain text title"}\n',
    );
    await writeFile(messagePath, '{"type":"user","message":{"content":"Message content title"}}\n');
    await writeFile(fallbackPath, '{"type":"assistant","text":"only assistant"}\n');

    await expect(readSessionTitle(titleJsonlPath)).resolves.toBe('Plain text title');
    await expect(readSessionTitle(messagePath)).resolves.toBe('Message content title');
    await expect(readSessionTitle(fallbackPath)).resolves.toBe('fallback-title');
  });

  it('throws when reading a missing session title path', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    await expect(readSessionTitle(missingPath)).rejects.toThrow(missingPath);
  });
});

function createWorkspaceJsonlSessions(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-jsonl-sessions-'));
}

describe('jsonlSessions', () => {
  it('discovers Codex JSONL sessions under the store root', async () => {
    const workspace = await createWorkspaceJsonlSessions();
    const nested = join(workspace, '2026', '05', '04');
    const sessionPath = join(
      nested,
      'rollout-2026-05-04T03-05-27-019df04d-dc23-7751-bcd1-d03b60116746.jsonl',
    );
    await mkdir(nested, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","text":"Build Agent Session Pack"}\n');
    await writeFile(join(nested, 'notes.txt'), 'ignore me');

    const sessions = await codexProvider.discover({
      provider: 'codex',
      path: workspace,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: '019df04d-dc23-7751-bcd1-d03b60116746',
      provider: 'codex',
      title: 'Build Agent Session Pack',
      originalPath: sessionPath,
      slug: 'build-agent-session-pack',
    });
    expect(sessions[0].sizeBytes).toBeGreaterThan(0);
    expect(sessions[0].modifiedAt).toBeInstanceOf(Date);
  });

  it('discovers Claude Code user-level sessions and excludes subagents', async () => {
    const workspace = await createWorkspaceJsonlSessions();
    const project = join(workspace, '-Users-yosefhayimsabag-Desktop-Code-Agent-Session-Pack');
    const subagents = join(project, 'subagents');
    const sessionPath = join(project, '8bb71f3d-6036-4460-9852-376ec2676000.jsonl');
    await mkdir(subagents, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","message":{"content":"Catalog worker"}}\n');
    await writeFile(join(subagents, 'ignored.jsonl'), '{"type":"user","text":"ignore"}\n');

    const sessions = await claudeCodeProvider.discover({
      provider: 'claude',
      path: workspace,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: '8bb71f3d-6036-4460-9852-376ec2676000',
      provider: 'claude',
      title: 'Catalog worker',
      originalPath: sessionPath,
      slug: 'catalog-worker',
    });
  });

  it('discovers a title from a sparse JSONL file that is too large to read into one string', async () => {
    const workspace = await createWorkspaceJsonlSessions();
    const nested = join(workspace, '2026', '07', '06');
    const sessionPath = join(nested, 'rollout-2026-07-06T12-00-00-large-session.jsonl');
    await mkdir(nested, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","text":"Large local session"}\n');
    await truncate(sessionPath, bufferConstants.MAX_STRING_LENGTH + 1);

    const sessions = await codexProvider.discover({
      provider: 'codex',
      path: workspace,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: 'codex',
      title: 'Large local session',
      originalPath: sessionPath,
      slug: 'large-local-session',
    });
  });
});

function createWorkspaceDirectorySessions(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-directory-sessions-'));
}

describe('directorySessions', () => {
  it('discovers Grok multi-file session directories and skips active sessions', async () => {
    const workspace = await createWorkspaceDirectorySessions();
    const sessionsRoot = join(workspace, 'sessions');
    const project = join(sessionsRoot, encodeURIComponent('/Users/demo/Code'));
    const activeId = '019f4719-febb-7510-b27b-dda622dbb201';
    const coldId = '019f4719-febb-7510-b27b-dda622dbb202';
    const activePath = join(project, activeId);
    const coldPath = join(project, coldId);
    await mkdir(activePath, { recursive: true });
    await mkdir(coldPath, { recursive: true });
    await writeFile(
      join(workspace, 'active_sessions.json'),
      JSON.stringify(
        [
          {
            // biome-ignore lint/style/useNamingConvention: Grok stores this field name
            session_id: activeId,
            pid: 1,
          },
        ],
        null,
        2,
      ),
    );
    await writeFile(
      join(activePath, 'summary.json'),
      JSON.stringify({
        info: { id: activeId, cwd: '/Users/demo/Code' },
        // biome-ignore lint/style/useNamingConvention: Grok stores this field name
        agent_name: 'active',
      }),
    );
    await writeFile(join(activePath, 'updates.jsonl'), '{"type":"user","text":"active"}\n');
    await writeFile(
      join(coldPath, 'summary.json'),
      JSON.stringify({
        info: { id: coldId, cwd: '/Users/demo/Code' },
        // biome-ignore lint/style/useNamingConvention: Grok stores this field name
        agent_name: 'grok-build',
        // biome-ignore lint/style/useNamingConvention: Grok stores this field name
        session_summary: '',
      }),
    );
    await writeFile(join(coldPath, 'updates.jsonl'), '{"type":"user","text":"cold"}\n');

    const sessions = await grokProvider.discover({
      provider: 'grok',
      path: sessionsRoot,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: coldId,
      provider: 'grok',
      sourceKind: 'directory',
      originalPath: coldPath,
      title: 'grok-build @ Code',
    });
  });

  it('discovers Kimi Code multi-file session directories', async () => {
    const workspace = await createWorkspaceDirectorySessions();
    const sessionPath = join(
      workspace,
      'wd_demo_abc',
      'session_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    );
    await mkdir(sessionPath, { recursive: true });
    await writeFile(
      join(sessionPath, 'state.json'),
      JSON.stringify({ title: 'Deploy portfolio app', updatedAt: '2026-07-01T00:00:00.000Z' }),
    );
    await mkdir(join(sessionPath, 'agents', 'main'), { recursive: true });
    await writeFile(join(sessionPath, 'agents', 'main', 'wire.jsonl'), '{"type":"user"}\n');

    const sessions = await kimiProvider.discover({
      provider: 'kimi',
      path: workspace,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      provider: 'kimi',
      sourceKind: 'directory',
      title: 'Deploy portfolio app',
      originalPath: sessionPath,
    });
  });
});

const execFileAsync = promisify(execFile);

function createWorkspaceDevin(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-devin-'));
}

describe('Devin provider discovery', () => {
  it('discovers sessions from the Devin SQLite store without reading credentials', async () => {
    const workspace = await createWorkspaceDevin();
    const root = join(workspace, 'devin', 'cli');
    const dbPath = join(root, 'sessions.db');
    await mkdir(root, { recursive: true });
    await execFileAsync('sqlite3', [dbPath, createDevinFixtureSql()]);

    const sessions = await devinProvider.discover({
      provider: 'devin',
      path: root,
    });

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: 'calm-river',
      provider: 'devin',
      title: 'Investigate local Devin storage',
      slug: 'investigate-local-devin-storage',
      originalPath: dbPath,
      status: 'live',
    });
    expect(sessions[0].createdAt?.toISOString()).toBe('2026-07-06T10:00:00.000Z');
    expect(sessions[0].modifiedAt.toISOString()).toBe('2026-07-06T10:30:00.000Z');
    expect(sessions[0].sizeBytes).toBeGreaterThan(0);
  });
});

function createDevinFixtureSql(): string {
  return `
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  working_directory TEXT NOT NULL,
  backend_type TEXT NOT NULL,
  model TEXT NOT NULL,
  agent_mode TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL,
  title TEXT,
  main_chain_id INTEGER,
  shell_last_seen_index INTEGER DEFAULT 0,
  cogs_json TEXT,
  workspace_dirs TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  metadata TEXT
);

CREATE TABLE prompt_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  is_shell INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE message_nodes (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  parent_node_id INTEGER,
  chat_message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE TABLE rendered_commits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  sequence_number INTEGER NOT NULL,
  rendered_html TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE tool_call_state (
  session_id TEXT NOT NULL,
  tool_call_id TEXT NOT NULL,
  tool_call_json TEXT,
  tool_call_update_json TEXT
);

INSERT INTO sessions (
  id,
  working_directory,
  backend_type,
  model,
  agent_mode,
  created_at,
  last_activity_at,
  title,
  hidden
) VALUES (
  'calm-river',
  '/tmp/project',
  'Windsurf',
  'claude-opus-4-8-high',
  'bypass',
  1783332000,
  1783333800,
  'Investigate local Devin storage',
  0
);

INSERT INTO prompt_history (content, timestamp, session_id)
VALUES ('please inspect the local session store', 1783332001, 'calm-river');

INSERT INTO message_nodes (session_id, node_id, chat_message, created_at, metadata)
VALUES ('calm-river', 1, '{"role":"assistant","content":"done"}', 1783332100, '{"safe":true}');

INSERT INTO rendered_commits (session_id, sequence_number, rendered_html, created_at)
VALUES ('calm-river', 1, '<p>summary</p>', 1783332200);
`;
}
