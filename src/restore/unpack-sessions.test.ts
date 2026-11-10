import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyCompression, createArchiveProvider, writeColdSession } from '@/archive/fixtures.js';
import {
  listSessionManifestPaths,
  readSessionManifest,
  writeSessionManifest,
} from '@/archive/manifest-store.js';
import { packProviderSessions } from '@/pack/sessions.js';
import type { DiscoveredSession, ProviderAdapter } from '@/session-model.js';
import { unpackProviderSessions } from './unpack-sessions.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-unpack-sessions-'));

describe('unpackProviderSessions', () => {
  it('reports unpack dry-run and no-archives rows without restoring originals', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const originalPath = join(home, '.codex', 'sessions', 'cold.jsonl');
    const archivePath = join(vaultPath, 'archives', 'codex', 'cold.jsonl.zst');
    const manifestPath = join(vaultPath, 'manifests', 'codex', 'cold.json');
    const sessionJsonl = '{"type":"user","text":"archived"}\n';

    await mkdir(join(vaultPath, 'archives', 'codex'), { recursive: true });
    await writeFile(archivePath, sessionJsonl);
    await writeSessionManifest(manifestPath, {
      sessionId: 'cold',
      provider: 'codex',
      title: 'archived',
      slug: 'archived',
      originalPath,
      archivePath,
      sourceSha256: 'deadbeef',
      sourceBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
      archivedAt: '2026-07-01T00:00:00.000Z',
      sourceKind: 'file',
    });

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Promise.resolve([]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Promise.resolve([]),
      }),
    ];

    const report = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: false,
      compression: copyCompression,
    });

    expect(report.command).toBe('unpack');
    expect(report.apply).toBe(false);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          status: 'dry-run',
          archivedSessions: 1,
          restoredSessions: 0,
          beforeBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
          archiveBytes: Buffer.byteLength(sessionJsonl, 'utf8'),
          touchedOriginals: false,
          reason: '--apply required to restore originals',
        }),
        expect.objectContaining({
          provider: 'claude',
          status: 'no-archives',
          archivedSessions: 0,
          reason: 'no manifests found in vault',
        }),
      ]),
    );

    await expect(stat(originalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    const manifests = await listSessionManifestPaths(join(vaultPath, 'manifests'));
    expect(manifests).toEqual([manifestPath]);
    const manifest = await readSessionManifest(manifestPath);
    expect(manifest.sessionId).toBe('cold');
  });

  it('packs a cold file session on apply and unpacks it back with byte-exact content', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const sessionJsonl = '{"type":"user","text":"apply pack unpack"}\n';
    const session = await writeColdSession({
      home,
      relativeDir: join('.codex', 'sessions', '2026', '06', '01'),
      fileName: 'apply-session.jsonl',
      content: sessionJsonl,
      modifiedAt: coldModifiedAt,
    });

    const discovered: DiscoveredSession = {
      id: 'apply-session',
      provider: 'codex',
      title: 'apply pack unpack',
      slug: 'apply-pack-unpack',
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

    const packReport = await packProviderSessions({
      home,
      vaultPath,
      providers,
      olderThan: '7d',
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      now,
      apply: true,
      compression: copyCompression,
    });

    expect(packReport.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'packed',
        packedSessions: 1,
        touchedOriginals: true,
      }),
    ]);
    // Packed path keeps a listable stub so GUIs can still see the session.
    const stubAfterPack = JSON.parse(await readFile(session.path, 'utf8')) as {
      agentSessionPack: string;
    };
    expect(stubAfterPack.agentSessionPack).toBe('agent-session-pack-archived-stub');

    const unpackReport = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: true,
      compression: copyCompression,
    });

    expect(unpackReport.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'restored',
        restoredSessions: 1,
        touchedOriginals: true,
      }),
    ]);
    await expect(readFile(session.path, 'utf8')).resolves.toBe(sessionJsonl);

    const alreadyPresent = await unpackProviderSessions({
      vaultPath,
      providers,
      apply: true,
      compression: copyCompression,
    });

    expect(alreadyPresent.rows).toEqual([
      expect.objectContaining({
        provider: 'codex',
        status: 'already-present',
        alreadyPresentSessions: 1,
        restoredSessions: 0,
        touchedOriginals: false,
      }),
    ]);
  });
});
