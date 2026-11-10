import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mainCommand } from './main.js';

interface PackageManifest {
  readonly version: string;
}

interface VersionedCommandMeta {
  readonly version?: string;
}

const readPackageManifest = async (): Promise<PackageManifest> => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(testDirectory, '..', '..', 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8')) as PackageManifest;

  return packageManifest;
};

describe('main command metadata', () => {
  it('uses the package version in CLI help output', async () => {
    const packageManifest = await readPackageManifest();
    const commandMeta = (await Promise.resolve(mainCommand.meta)) as unknown as
      | VersionedCommandMeta
      | undefined;

    expect(commandMeta?.version).toBe(packageManifest.version);
  });
});
