import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { ProviderIdSchema, SessionOriginKindSchema } from '@/session-model.js';
import { readDirectoryDirents } from './file-system.js';

const SessionManifestSchema = z.object({
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
  sourceKind: SessionOriginKindSchema.optional(),
});

export type SessionManifest = z.infer<typeof SessionManifestSchema>;

export const writeSessionManifest = async (
  path: string,
  manifest: SessionManifest,
): Promise<void> => {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    throw new Error(`Could not write session manifest ${path}`, { cause: error });
  }
};

export const readSessionManifest = async (path: string): Promise<SessionManifest> => {
  try {
    const manifestString = await readFile(path, 'utf8');
    const manifestDocument: unknown = JSON.parse(manifestString);
    return SessionManifestSchema.parse(manifestDocument);
  } catch (error) {
    throw new Error(`Could not read session manifest ${path}`, { cause: error });
  }
};

export const listSessionManifestPaths = (root: string): Promise<ReadonlyArray<string>> =>
  collectManifestPaths(root);

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
  const dirents = await readDirectoryDirents(root);
  const paths: string[] = [];

  for (const dirent of dirents) {
    const childPath = join(root, dirent.name);

    const isChildDirectory = dirent.isDirectory();
    if (isChildDirectory) {
      paths.push(...(await collectManifestPaths(childPath)));
      continue;
    }

    const isNotFile = !dirent.isFile();
    if (isNotFile) {
      continue;
    }

    const isNotNameEndsWith = !dirent.name.endsWith('.json');
    if (isNotNameEndsWith) {
      continue;
    }

    paths.push(childPath);
  }

  return paths;
};
