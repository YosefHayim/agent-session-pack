import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCompression, createArchiveProvider, writeColdSession } from '@/archive/fixtures.js';
import { packProviderSessions } from '@/pack/sessions.js';
import type { DiscoveredSession, ProviderAdapter } from '@/session-model.js';
import { ensureSessionRestored } from './ensure-restored.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-ensure-restored-'));

describe('ensureSessionRestored', () => {
  it('ensures one archived session is restored with lifecycle enabled and refuses conflicts', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const sessionJsonl = '{"type":"user","text":"ensure restored"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'ensure-session.jsonl',
      content: sessionJsonl,
      modifiedAt: coldModifiedAt,
    });

    const discovered: DiscoveredSession = {
      id: 'ensure-session',
      provider: 'codex',
      title: 'ensure restored',
      slug: 'ensure-restored',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([discovered]),
      }),
    ];

    await packProviderSessions({
      home,
      vaultPath,
      providers,
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      now,
      apply: true,
      compression: copyCompression,
    });
    const stubAfterPack = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    expect(stubAfterPack.agentSessionPack).toBe('agent-session-pack-archived-stub');

    const disabled = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: false,
      requireLifecycleEnabled: true,
    });
    expect(disabled.status).toBe('lifecycle-disabled');
    await expect(readFile(session.path, 'utf8')).resolves.toContain(
      'agent-session-pack-archived-stub',
    );

    const restored = await ensureSessionRestored({
      command: 'ensure-restored',
      vaultPath,
      selector: 'codex:ensure-session',
      selectorMatch: 'exact',
      provider: undefined,
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: true,
    });
    expect(restored).toMatchObject({
      status: 'restored',
      provider: 'codex',
      sessionId: 'ensure-session',
      originalPath: session.path,
    });
    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);

    const alreadyPresent = await ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: false,
    });
    expect(alreadyPresent.status).toBe('already-present');

    await writeFile(session.path, '{"type":"user","text":"changed live"}\n');
    const conflict = await ensureSessionRestored({
      command: 'restore',
      vaultPath,
      selector: 'ensure-session',
      selectorMatch: 'exact',
      provider: 'codex',
      compression: copyCompression,
      restoreOnLaunchEnabled: true,
      requireLifecycleEnabled: false,
    });
    expect(conflict.status).toBe('conflict');
    await expect(readFile(session.path, 'utf8')).resolves.toBe(
      '{"type":"user","text":"changed live"}\n',
    );
  });
});
