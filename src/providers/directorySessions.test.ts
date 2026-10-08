import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { grokProvider } from './grok.js';
import { kimiProvider } from './kimi.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-directory-sessions-'));

describe('directorySessions', () => {
  it('discovers Grok multi-file session directories and skips active sessions', async () => {
    const workspace = await createWorkspace();
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
      JSON.stringify([{ session_id: activeId, pid: 1 }], null, 2),
    );
    await writeFile(
      join(activePath, 'summary.json'),
      JSON.stringify({ info: { id: activeId, cwd: '/Users/demo/Code' }, agent_name: 'active' }),
    );
    await writeFile(join(activePath, 'updates.jsonl'), '{"type":"user","text":"active"}\n');
    await writeFile(
      join(coldPath, 'summary.json'),
      JSON.stringify({
        info: { id: coldId, cwd: '/Users/demo/Code' },
        agent_name: 'grok-build',
        session_summary: '',
      }),
    );
    await writeFile(join(coldPath, 'updates.jsonl'), '{"type":"user","text":"cold"}\n');

    const sessions = await Effect.runPromise(
      grokProvider.discover({
        provider: 'grok',
        path: sessionsRoot,
      }),
    );

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
    const workspace = await createWorkspace();
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

    const sessions = await Effect.runPromise(
      kimiProvider.discover({
        provider: 'kimi',
        path: workspace,
      }),
    );

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
