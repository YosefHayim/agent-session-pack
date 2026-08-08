import { constants as bufferConstants } from 'node:buffer';
import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { claudeCodeProvider } from './claudeCode.js';
import { codexProvider } from './codex.js';
import { grokProvider } from './grok.js';
import { kimiProvider } from './kimi.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-provider-'));

describe('provider discovery', () => {
  it('discovers Codex JSONL sessions under the store root', async () => {
    const workspace = await createWorkspace();
    const nested = join(workspace, '2026', '05', '04');
    const sessionPath = join(
      nested,
      'rollout-2026-05-04T03-05-27-019df04d-dc23-7751-bcd1-d03b60116746.jsonl',
    );
    await mkdir(nested, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","text":"Build Agent Session Pack"}\n');
    await writeFile(join(nested, 'notes.txt'), 'ignore me');

    const sessions = await Effect.runPromise(
      codexProvider.discover({
        provider: 'codex',
        path: workspace,
      }),
    );

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
    const workspace = await createWorkspace();
    const project = join(workspace, '-Users-yosefhayimsabag-Desktop-Code-Agent-Session-Pack');
    const subagents = join(project, 'subagents');
    const sessionPath = join(project, '8bb71f3d-6036-4460-9852-376ec2676000.jsonl');
    await mkdir(subagents, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","message":{"content":"Catalog worker"}}\n');
    await writeFile(join(subagents, 'ignored.jsonl'), '{"type":"user","text":"ignore"}\n');

    const sessions = await Effect.runPromise(
      claudeCodeProvider.discover({
        provider: 'claude',
        path: workspace,
      }),
    );

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
    const workspace = await createWorkspace();
    const nested = join(workspace, '2026', '07', '06');
    const sessionPath = join(nested, 'rollout-2026-07-06T12-00-00-large-session.jsonl');
    await mkdir(nested, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","text":"Large local session"}\n');
    await truncate(sessionPath, bufferConstants.MAX_STRING_LENGTH + 1);

    const sessions = await Effect.runPromise(
      codexProvider.discover({
        provider: 'codex',
        path: workspace,
      }),
    );

    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      provider: 'codex',
      title: 'Large local session',
      originalPath: sessionPath,
      slug: 'large-local-session',
    });
  });

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
