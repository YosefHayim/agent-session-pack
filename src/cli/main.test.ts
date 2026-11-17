import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderUsage } from 'citty';
import { describe, expect, it } from 'vitest';
import { isCliEntrypoint } from '@/cli/main.js';
import { mainCommand } from './main.js';

interface PackageManifest {
  readonly version: string;
}

async function readPackageManifest(): Promise<PackageManifest> {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const packagePath = join(testDirectory, '..', '..', 'package.json');
  const packageManifest = JSON.parse(await readFile(packagePath, 'utf8')) as PackageManifest;

  return packageManifest;
}

describe('main command metadata', () => {
  it('uses the package version in CLI help output', async () => {
    const packageManifest = await readPackageManifest();
    const renderedUsage = await renderUsage(mainCommand);

    expect(renderedUsage).toContain(packageManifest.version);
  });
});

describe('CLI entrypoint detection', () => {
  it('accepts npm bin symlinks that resolve to the built module path', () => {
    function realpath(path: string): string {
      const isInstalledBinPath = path === '/prefix/bin/agent-session-pack';
      if (isInstalledBinPath) {
        return '/package/dist/cli/main.js';
      }

      return path;
    }

    expect(
      isCliEntrypoint('/prefix/bin/agent-session-pack', '/package/dist/cli/main.js', realpath),
    ).toBe(true);
  });
});
