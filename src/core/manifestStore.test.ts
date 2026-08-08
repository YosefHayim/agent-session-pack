import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect, Either } from 'effect';
import { describe, expect, it } from 'vitest';
import {
  listSessionManifestPaths,
  ManifestStoreError,
  readSessionManifest,
  type SessionManifest,
  writeSessionManifest,
} from './manifestStore.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-manifest-'));

const sampleManifest = (overrides: Partial<SessionManifest> = {}): SessionManifest => ({
  sessionId: 'session-1',
  provider: 'codex',
  title: 'Pack cold sessions',
  slug: 'pack-cold-sessions',
  originalPath: '/tmp/synthetic/session-1.jsonl',
  archivePath: '/tmp/synthetic/session-1.jsonl.zst',
  sourceSha256: 'abc123',
  sourceBytes: 128,
  archiveBytes: 40,
  archivedAt: '2026-07-06T12:00:00.000Z',
  sourceKind: 'file',
  ...overrides,
});

describe('manifestStore', () => {
  it('writes and reads a session manifest with optional fields', async () => {
    const workspace = await createWorkspace();
    const manifestPath = join(workspace, 'manifests', 'codex', 'session-1.json');
    const manifest = sampleManifest({
      sourceKind: 'directory',
      archiveBytes: 99,
    });

    await Effect.runPromise(writeSessionManifest(manifestPath, manifest));
    const decoded = await Effect.runPromise(readSessionManifest(manifestPath));

    expect(decoded).toEqual(manifest);
  });

  it('lists nested manifest JSON paths and ignores non-json files', async () => {
    const workspace = await createWorkspace();
    const root = join(workspace, 'manifests');
    const codexPath = join(root, 'codex', 'session-a.json');
    const claudePath = join(root, 'claude', 'nested', 'session-b.json');
    const ignored = join(root, 'codex', 'notes.txt');

    await Effect.runPromise(writeSessionManifest(codexPath, sampleManifest({ sessionId: 'a' })));
    await Effect.runPromise(
      writeSessionManifest(
        claudePath,
        sampleManifest({
          sessionId: 'b',
          provider: 'claude',
        }),
      ),
    );
    await mkdir(join(root, 'codex'), { recursive: true });
    await writeFile(ignored, 'not a manifest');

    const paths = await Effect.runPromise(listSessionManifestPaths(root));

    expect(paths).toHaveLength(2);
    expect(paths).toEqual(expect.arrayContaining([codexPath, claudePath]));
    expect(paths.some((path) => path.endsWith('notes.txt'))).toBe(false);
  });

  it('returns an empty list when the manifest root is missing', async () => {
    const workspace = await createWorkspace();
    const missingRoot = join(workspace, 'does-not-exist');

    const paths = await Effect.runPromise(listSessionManifestPaths(missingRoot));

    expect(paths).toEqual([]);
  });

  it('returns ManifestStoreError when reading a missing manifest', async () => {
    const workspace = await createWorkspace();
    const missingPath = join(workspace, 'missing.json');

    const result = await Effect.runPromise(Effect.either(readSessionManifest(missingPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected readSessionManifest to fail for a missing file');
    }
    expect(result.left).toBeInstanceOf(ManifestStoreError);
    expect(result.left).toMatchObject({
      _tag: 'ManifestStoreError',
      path: missingPath,
    });
  });

  it('returns ManifestStoreError when the manifest JSON is invalid', async () => {
    const workspace = await createWorkspace();
    const badPath = join(workspace, 'bad.json');
    await writeFile(badPath, '{"sessionId":123}\n');

    const result = await Effect.runPromise(Effect.either(readSessionManifest(badPath)));

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected readSessionManifest to fail for invalid schema');
    }
    expect(result.left).toBeInstanceOf(ManifestStoreError);
    expect(result.left).toMatchObject({
      _tag: 'ManifestStoreError',
      path: badPath,
    });
  });

  it('returns ManifestStoreError when writing to an unwritable path', async () => {
    const workspace = await createWorkspace();
    const blockedParent = join(workspace, 'blocked');
    await writeFile(blockedParent, 'I am a file, not a directory');
    const destination = join(blockedParent, 'child', 'manifest.json');

    const result = await Effect.runPromise(
      Effect.either(writeSessionManifest(destination, sampleManifest())),
    );

    expect(Either.isLeft(result)).toBe(true);
    if (Either.isRight(result)) {
      expect.fail('expected writeSessionManifest to fail for an unwritable path');
    }
    expect(result.left).toBeInstanceOf(ManifestStoreError);
    expect(result.left).toMatchObject({
      _tag: 'ManifestStoreError',
      path: destination,
    });
  });
});
