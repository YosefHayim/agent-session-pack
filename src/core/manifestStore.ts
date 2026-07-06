import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Effect, Schema } from 'effect';
import { ProviderIdSchema } from './sessionStore.js';

export const SessionManifestSchema = Schema.Struct({
  sessionId: Schema.String,
  provider: ProviderIdSchema,
  title: Schema.String,
  slug: Schema.String,
  originalPath: Schema.String,
  archivePath: Schema.String,
  sourceSha256: Schema.String,
  sourceBytes: Schema.Number,
  archivedAt: Schema.String,
});
export type SessionManifest = typeof SessionManifestSchema.Type;

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
