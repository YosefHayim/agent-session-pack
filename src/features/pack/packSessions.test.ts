import { mkdtemp, readFile, stat } from 'node:fs/promises';
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
import { packProviderSessions } from './packSessions.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-pack-sessions-'));

describe('packProviderSessions', () => {
  it('reports missing, backup-only, no-candidates, and dry-run pack rows without touching originals', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack-test');
    const coldModifiedAt = new Date('2026-06-01T12:00:00.000Z');
    const warmModifiedAt = new Date('2026-07-06T10:00:00.000Z');
    const now = new Date('2026-07-06T12:00:00.000Z');
    const olderThanMs = 24 * 60 * 60 * 1000;

    const coldSession = await writeColdSession(
      home,
      join('.codex', 'sessions', '2026', '06', '01'),
      'cold.jsonl',
      '{"type":"user","text":"cold session"}\n',
      coldModifiedAt,
    );
    const warmSession = await writeColdSession(
      home,
      join('.claude', 'projects', 'demo'),
      'warm.jsonl',
      '{"type":"user","text":"warm session"}\n',
      warmModifiedAt,
    );
    const backupSession = await writeColdSession(
      home,
      join('.cursor', 'projects', 'demo'),
      'backup.jsonl',
      '{"type":"user","text":"backup only"}\n',
      coldModifiedAt,
    );

    const coldDiscovered: DiscoveredSession = {
      id: 'cold',
      provider: 'codex',
      title: 'cold session',
      slug: 'cold-session',
      originalPath: coldSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(coldSession.content, 'utf8'),
      sourceKind: 'file',
    };
    const warmDiscovered: DiscoveredSession = {
      id: 'warm',
      provider: 'claude',
      title: 'warm session',
      slug: 'warm-session',
      originalPath: warmSession.path,
      modifiedAt: warmModifiedAt,
      sizeBytes: Buffer.byteLength(warmSession.content, 'utf8'),
      sourceKind: 'file',
    };
    const backupDiscovered: DiscoveredSession = {
      id: 'backup',
      provider: 'cursor',
      title: 'backup only',
      slug: 'backup-only',
      originalPath: backupSession.path,
      modifiedAt: coldModifiedAt,
      sizeBytes: Buffer.byteLength(backupSession.content, 'utf8'),
      sourceKind: 'file',
    };

    const providers: ReadonlyArray<ProviderAdapter> = [
      createArchiveProvider({
        id: 'codex',
        mode: 'archive',
        rootRelative: join('.codex', 'sessions'),
        discover: () => Effect.succeed([coldDiscovered]),
      }),
      createArchiveProvider({
        id: 'claude',
        mode: 'archive',
        rootRelative: join('.claude', 'projects'),
        discover: () => Effect.succeed([warmDiscovered]),
      }),
      createArchiveProvider({
        id: 'cursor',
        mode: 'backup-only',
        rootRelative: join('.cursor', 'projects'),
        discover: () => Effect.succeed([backupDiscovered]),
      }),
      createArchiveProvider({
        id: 'kiro',
        mode: 'archive',
        rootRelative: join('.kiro', 'sessions'),
        discover: () => Effect.succeed([]),
      }),
    ];

    const report = await Effect.runPromise(
      packProviderSessions({
        home,
        vaultPath,
        providers,
        olderThan: '24h',
        olderThanMs,
        now,
        apply: false,
        compression: copyCompression,
      }),
    );

    expect(report.command).toBe('pack');
    expect(report.apply).toBe(false);
    expect(report.vaultPath).toBe(vaultPath);
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: 'codex',
          status: 'dry-run',
          foundSessions: 1,
          candidateSessions: 1,
          packedSessions: 0,
          beforeBytes: coldDiscovered.sizeBytes,
          touchedOriginals: false,
          reason: '--apply required to write archives',
        }),
        expect.objectContaining({
          provider: 'claude',
          status: 'no-candidates',
          foundSessions: 1,
          candidateSessions: 0,
          reason: 'no sessions older than threshold',
        }),
        expect.objectContaining({
          provider: 'cursor',
          status: 'backup-only',
          foundSessions: 1,
          reason: 'backup-only provider is not mutated',
        }),
        expect.objectContaining({
          provider: 'kiro',
          status: 'missing',
          foundSessions: 0,
          reason: 'provider store not found',
        }),
      ]),
    );
    expect(report.thresholdPreviews.length).toBeGreaterThan(0);

    await expect(readFile(coldSession.path, 'utf8')).resolves.toBe(coldSession.content);
    await expect(readFile(warmSession.path, 'utf8')).resolves.toBe(warmSession.content);
    await expect(readFile(backupSession.path, 'utf8')).resolves.toBe(backupSession.content);
    await expect(stat(join(vaultPath, 'archives'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
