import { execFile } from 'node:child_process';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { devinProvider } from '../src/providers/index.js';

const execFileAsync = promisify(execFile);

const createWorkspace = (): Promise<string> => mkdtemp(join(tmpdir(), 'agent-session-pack-devin-'));

describe('Devin provider discovery', () => {
  it('discovers sessions from the Devin SQLite store without reading credentials', async () => {
    const workspace = await createWorkspace();
    const root = join(workspace, 'devin', 'cli');
    const dbPath = join(root, 'sessions.db');
    await mkdir(root, { recursive: true });
    await execFileAsync('sqlite3', [dbPath, createDevinFixtureSql()]);

    const sessions = await Effect.runPromise(
      devinProvider.discover({
        provider: 'devin',
        path: root,
      }),
    );

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

const createDevinFixtureSql = (): string => `
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
