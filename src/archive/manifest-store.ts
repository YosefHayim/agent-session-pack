import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { rethrowAsError } from '@/rethrow-as-error.js';
import { ProviderIdSchema, SessionSourceKindSchema } from '@/session-model.js';
import { readDirectoryEntries } from './file-system.js';

/**
 * Schema describing the restore manifest recorded for an archived session.
 */
export const SessionManifestSchema = z.object({
  sessionId: z.string(),
  provider: ProviderIdSchema,
  title: z.string(),
  slug: z.string(),
  originalPath: z.string(),
  archivePath: z.string(),
  sourceSha256: z.string(),
  sourceBytes: z.number(),
  archiveBytes: z.number().optional(),
  archivedAt: z.string(),
  sourceKind: SessionSourceKindSchema.optional(),
});

/**
 * Decoded session manifest record used to drive restores.
 */
export type SessionManifest = z.infer<typeof SessionManifestSchema>;

/**
 * Writes a session manifest as formatted JSON.
 */
export const writeSessionManifest = async (
  path: string,
  manifest: SessionManifest,
): Promise<void> => {
  await mkdir(dirname(path), { recursive: true }).catch(rethrowAsError);
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`).catch(rethrowAsError);
};

/**
 * Reads and decodes a session manifest.
 */
export const readSessionManifest = async (path: string): Promise<SessionManifest> => {
  const content = await readFile(path, 'utf8').catch(rethrowAsError);
  return SessionManifestSchema.parse(JSON.parse(content));
};

/**
 * Lists all manifest JSON files below a vault manifest root.
 */
export const listSessionManifestPaths = (root: string): Promise<ReadonlyArray<string>> =>
  collectManifestPaths(root);

/**
 * Lists every session manifest stored under a vault.
 */
export const listVaultSessionManifests = async (
  vaultPath: string,
): Promise<ReadonlyArray<SessionManifest>> => {
  const manifestPaths = await listSessionManifestPaths(join(vaultPath, 'manifests'));
  const manifests: SessionManifest[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = await readSessionManifest(manifestPath);
    manifests.push(manifest);
  }

  return manifests;
};

const collectManifestPaths = async (root: string): Promise<ReadonlyArray<string>> => {
  const entries = await readDirectoryEntries(root);
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
