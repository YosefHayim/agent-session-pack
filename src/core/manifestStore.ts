import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Effect, Schema } from 'effect';
import { ProviderIdSchema } from './sessionStore.js';

/**
 * Schema describing the restore manifest recorded for an archived session.
 */
export const SessionManifestSchema = Schema.Struct({
  sessionId: Schema.String,
  provider: ProviderIdSchema,
  title: Schema.String,
  slug: Schema.String,
  originalPath: Schema.String,
  archivePath: Schema.String,
  sourceSha256: Schema.String,
  sourceBytes: Schema.Number,
  archiveBytes: Schema.optional(Schema.Number),
  archivedAt: Schema.String,
});
/**
 * Decoded session manifest record used to drive restores.
 */
export type SessionManifest = typeof SessionManifestSchema.Type;

/**
 * Typed error raised when reading or writing a session manifest fails.
 */
export class ManifestStoreError extends Schema.TaggedError<ManifestStoreError>()(
  'ManifestStoreError',
  {
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Writes a session manifest as formatted JSON.
 *
 * @param path - Manifest destination path.
 * @param manifest - Restore metadata to persist.
 * @returns Effect completing after write.
 * @example
 * ```ts
 * import { writeSessionManifest } from './manifestStore.js';
 *
 * await Effect.runPromise(writeSessionManifest('/vault/manifests/abc.json', manifest));
 * ```
 */
export const writeSessionManifest = (
  path: string,
  manifest: SessionManifest,
): Effect.Effect<void, ManifestStoreError> =>
  Effect.tryPromise({
    try: async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
    },
    catch: (cause) =>
      new ManifestStoreError({
        path,
        message: String(cause),
      }),
  });

/**
 * Reads and decodes a session manifest.
 *
 * @param path - Manifest file path.
 * @returns Effect containing decoded manifest data.
 * @example
 * ```ts
 * import { readSessionManifest } from './manifestStore.js';
 *
 * const manifest = await Effect.runPromise(readSessionManifest('/vault/manifests/abc.json'));
 * ```
 */
export const readSessionManifest = (
  path: string,
): Effect.Effect<SessionManifest, ManifestStoreError> =>
  Effect.tryPromise({
    try: async () => {
      const content = await readFile(path, 'utf8');
      const decoded = Schema.decodeUnknownSync(SessionManifestSchema)(JSON.parse(content));

      return decoded;
    },
    catch: (cause) =>
      new ManifestStoreError({
        path,
        message: String(cause),
      }),
  });

/**
 * Lists all manifest JSON files below a vault manifest root.
 *
 * @param root - Manifest root directory.
 * @returns Effect containing manifest file paths.
 * @example
 * ```ts
 * import { listSessionManifestPaths } from './manifestStore.js';
 *
 * const paths = await Effect.runPromise(listSessionManifestPaths('/vault/manifests'));
 * ```
 */
export const listSessionManifestPaths = (
  root: string,
): Effect.Effect<ReadonlyArray<string>, ManifestStoreError> =>
  Effect.tryPromise({
    try: () => collectManifestPaths(root),
    catch: (cause) =>
      new ManifestStoreError({
        path: root,
        message: String(cause),
      }),
  });

const collectManifestPaths = async (root: string): Promise<ReadonlyArray<string>> => {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const paths: string[] = [];

  for (const entry of entries) {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      paths.push(...(await collectManifestPaths(entryPath)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('.json')) {
      continue;
    }

    paths.push(entryPath);
  }

  return paths;
};
