import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mainCommand } from './main.js';

interface PackageJson {
  readonly version: string;
}

interface VersionedCommandMeta {
  readonly version?: string;
}

const readPackageJson = async (): Promise<PackageJson> => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(testDirectory, '..', '..', 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as PackageJson;

  return packageJson;
};

describe('main command metadata', () => {
  it('uses the package version in CLI help output', async () => {
    const packageJson = await readPackageJson();
    const commandMeta = (await Promise.resolve(mainCommand.meta)) as unknown as
      | VersionedCommandMeta
      | undefined;

    expect(commandMeta?.version).toBe(packageJson.version);
  });
});
