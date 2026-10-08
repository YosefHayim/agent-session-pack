import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  copyCompression,
  createArchiveProvider,
  writeColdSession,
} from '../../../tests/archiveFixtures.js';
import type { DiscoveredSession, ProviderAdapter } from '../../shared/sessionModel.js';
import { packProviderSessions } from '../pack/packSessions.js';
import { ensureSessionRestored } from './ensureRestored.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-ensure-restored-'));

describe('ensureSessionRestored', () => {
  it('ensures one archived session is restored with lifecycle enabled and refuses conflicts', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const content = '{"type":"user","text":"ensure restored"}\n';
    const session = await writeColdSession(
      home,
      join('.codex', 'sessions', '2026', '06', '01'),
      'ensure-session.jsonl',
      content,
      coldModifiedAt,
    );

    const discovered: DiscoveredSession = {
      id: 'ensure-session',
      provider: 'codex',
      title: 'ensure restored',
      slug: 'ensure-restored',
      originalPath: session.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(content, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([discovered]),
      }),
    ];

    await Effect.runPromise(
      packProviderSessions({
        home,
        vaultPath,
        providers,
        olderThan: '7d',
        olderThanMs: 7 * 24 * 60 * 60 * 1000,
        now,
        apply: true,
        compression: copyCompression,
      }),
    );
    const stubAfterPack = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    expect(stubAfterPack.agentSessionPack).toBe('agent-session-pack-archived-stub');

    const disabled = await Effect.runPromise(
      ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath,
        selector: 'ensure-session',
        selectorMatch: 'exact',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: false,
        requireLifecycleEnabled: true,
      }),
    );
    expect(disabled.status).toBe('lifecycle-disabled');
    await expect(readFile(session.path, 'utf8')).resolves.toContain(
      'agent-session-pack-archived-stub',
    );

    const restored = await Effect.runPromise(
      ensureSessionRestored({
        command: 'ensure-restored',
        vaultPath,
        selector: 'codex:ensure-session',
        selectorMatch: 'exact',
        provider: undefined,
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: true,
      }),
    );
    expect(restored).toMatchObject({
      status: 'restored',
      provider: 'codex',
      sessionId: 'ensure-session',
      originalPath: session.path,
    });
    await expect(readFile(session.path, 'utf8')).resolves.toBe(content);

    const alreadyPresent = await Effect.runPromise(
      ensureSessionRestored({
        command: 'restore',
        vaultPath,
        selector: 'ensure-session',
        selectorMatch: 'exact',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      }),
    );
    expect(alreadyPresent.status).toBe('already-present');

    await writeFile(session.path, '{"type":"user","text":"changed live"}\n');
    const conflict = await Effect.runPromise(
      ensureSessionRestored({
        command: 'restore',
        vaultPath,
        selector: 'ensure-session',
        selectorMatch: 'exact',
        provider: 'codex',
        compression: copyCompression,
        restoreOnLaunchEnabled: true,
        requireLifecycleEnabled: false,
      }),
    );
    expect(conflict.status).toBe('conflict');
    await expect(readFile(session.path, 'utf8')).resolves.toBe(
      '{"type":"user","text":"changed live"}\n',
    );
  });
});
