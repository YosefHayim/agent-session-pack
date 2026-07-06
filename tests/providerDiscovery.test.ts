import { constants as bufferConstants } from 'node:buffer';
import { mkdir, mkdtemp, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import { claudeCodeProvider, codexProvider } from '../src/providers/index.js';

const createWorkspace = (): Promise<string> => mkdtemp(join(tmpdir(), 'agent-recall-provider-'));

describe('provider discovery', () => {
  it('discovers Codex JSONL sessions under the store root', async () => {
    const workspace = await createWorkspace();
    const nested = join(workspace, '2026', '05', '04');
    const sessionPath = join(
      nested,
      'rollout-2026-05-04T03-05-27-019df04d-dc23-7751-bcd1-d03b60116746.jsonl',
    );
    await mkdir(nested, { recursive: true });
    await writeFile(sessionPath, '{"type":"user","text":"Build Agent Recall"}\n');
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
      title: 'Build Agent Recall',
      originalPath: sessionPath,
      slug: 'build-agent-recall',
    });
    expect(sessions[0].sizeBytes).toBeGreaterThan(0);
    expect(sessions[0].modifiedAt).toBeInstanceOf(Date);
  });

  it('discovers Claude Code user-level sessions and excludes subagents', async () => {
    const workspace = await createWorkspace();
    const project = join(workspace, '-Users-yosefhayimsabag-Desktop-Code-Agent-Recall');
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
});
