import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  collectJsonlSessions,
  type DiscoveredSession,
  measureDirectorySession,
  type ProviderAdapter,
  ProviderDiscoveryError,
  readSessionTitle,
  scanStores,
  sessionIdFromPath,
  slugifyTitle,
} from '../src/core/sessionStore.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-session-store-'));

describe('sessionStore discovery helpers', () => {
  it('slugifies titles and falls back for empty or punctuation-only input', () => {
    expect(slugifyTitle('Fix Login Bug')).toBe('fix-login-bug');
    expect(slugifyTitle('  Multi   Space  Title  ')).toBe('multi-space-title');
    expect(slugifyTitle('!!!')).toBe('untitled-session');
    expect(slugifyTitle('')).toBe('untitled-session');
  });

  it('extracts UUID session ids when present and otherwise uses the basename', () => {
    expect(
      sessionIdFromPath(
        '/sessions/rollout-2026-05-04T03-05-27-019df04d-dc23-7751-bcd1-d03b60116746.jsonl',
      ),
    ).toBe('019df04d-dc23-7751-bcd1-d03b60116746');
    expect(sessionIdFromPath('/sessions/plain-session.jsonl')).toBe('plain-session');
    expect(sessionIdFromPath('/sessions/no-extension')).toBe('no-extension');
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

    const files = await Effect.runPromise(
      collectJsonlSessions(workspace, {
        excludePathParts: ['subagents'],
      }),
    );

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      path: keepPath,
    });
    expect(files[0].sizeBytes).toBeGreaterThan(0);
    expect(files[0].modifiedAt).toBeInstanceOf(Date);
  });

  it('returns ProviderDiscoveryError when the collect root is missing', async () => {
    const workspace = await createWorkspace();
    const missingRoot = join(workspace, 'missing-root');

    const result = await Effect.runPromise(
      Effect.either(
        collectJsonlSessions(missingRoot, {
          excludePathParts: [],
        }),
      ),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected collectJsonlSessions to fail for a missing root');
    }
    expect(result.left).toBeInstanceOf(ProviderDiscoveryError);
    expect(result.left).toMatchObject({
      _tag: 'ProviderDiscoveryError',
      path: missingRoot,
    });
  });

  it('measures directory session size and newest mtime', async () => {
    const workspace = await createWorkspace();
    const sessionPath = join(workspace, 'session-dir');
    await mkdir(join(sessionPath, 'nested'), { recursive: true });
    await writeFile(join(sessionPath, 'summary.json'), '{"title":"dir"}\n');
    await writeFile(join(sessionPath, 'nested', 'updates.jsonl'), '{"type":"user","text":"hi"}\n');

    const entry = await Effect.runPromise(measureDirectorySession(sessionPath));

    expect(entry.path).toBe(sessionPath);
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(entry.modifiedAt).toBeInstanceOf(Date);
  });

  it('reads titles from user text, message content, and falls back to basename', async () => {
    const workspace = await createWorkspace();
    const textPath = join(workspace, 'text-title.jsonl');
    const messagePath = join(workspace, 'message-title.jsonl');
    const fallbackPath = join(workspace, 'fallback-title.jsonl');

    await writeFile(
      textPath,
      '{"type":"assistant","text":"no"}\n{"type":"user","text":"Plain text title"}\n',
    );
    await writeFile(messagePath, '{"type":"user","message":{"content":"Message content title"}}\n');
    await writeFile(fallbackPath, '{"type":"assistant","text":"only assistant"}\n');

    await expect(Effect.runPromise(readSessionTitle(textPath))).resolves.toBe('Plain text title');
    await expect(Effect.runPromise(readSessionTitle(messagePath))).resolves.toBe(
      'Message content title',
    );
    await expect(Effect.runPromise(readSessionTitle(fallbackPath))).resolves.toBe('fallback-title');
  });

  it('returns ProviderDiscoveryError when reading a missing session title path', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.jsonl');

    const result = await Effect.runPromise(Effect.either(readSessionTitle(missingPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected readSessionTitle to fail for a missing path');
    }
    expect(result.left).toBeInstanceOf(ProviderDiscoveryError);
    expect(result.left).toMatchObject({
      _tag: 'ProviderDiscoveryError',
      path: missingPath,
    });
  });

  it('scans stores through provider adapters and skips unknown providers', async () => {
    const workspace = await createWorkspace();
    const codexRoot = join(workspace, 'codex');
    const session: DiscoveredSession = {
      id: 'session-1',
      provider: 'codex',
      title: 'Synthetic scan',
      slug: 'synthetic-scan',
      originalPath: join(codexRoot, 'session-1.jsonl'),
      modifiedAt: new Date('2026-06-01T12:00:00.000Z'),
      sizeBytes: 32,
      sourceKind: 'file',
    };

    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: (home) => [join(home, '.codex', 'sessions')],
      discover: (store) => Effect.succeed(store.path === codexRoot ? [session] : []),
    };

    const report = await Effect.runPromise(
      scanStores({
        stores: [
          { provider: 'codex', path: codexRoot },
          { provider: 'claude', path: join(workspace, 'claude') },
        ],
        providers: [provider],
      }),
    );

    expect(report.sessions).toEqual([session]);
  });
});
