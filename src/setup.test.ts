import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSettingsPath,
  expandHomePath,
  readSetupSettings,
  runInitCommand,
  validateVaultPath,
  writeSetupSettings,
} from './setup.js';

function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'agent-session-pack-setup-'));
}

describe('setup config vault paths', () => {
  it('expands home paths and accepts a new vault below a writable parent', async () => {
    const home = await createWorkspace();
    const validatedPath = await validateVaultPath({
      home,
      inputPath: '~/.agent-session-pack',
      providerRoots: [join(home, '.codex', 'sessions')],
    });

    expect(validatedPath.path).toBe(join(home, '.agent-session-pack'));
    expect(expandHomePath('~/vault', home)).toBe(join(home, 'vault'));
  });

  it('rejects vault paths inside provider stores', async () => {
    const home = await createWorkspace();
    const providerRoot = join(home, '.codex', 'sessions');

    const validation = validateVaultPath({
      home,
      inputPath: join(providerRoot, 'vault'),
      providerRoots: [providerRoot],
    });

    await expect(validation).rejects.toThrow(
      'Vault path cannot be inside a provider session store.',
    );
  });

  it('rejects new vault paths when the parent directory does not exist', async () => {
    const home = await createWorkspace();

    const validation = validateVaultPath({
      home,
      inputPath: join(home, 'missing-parent', 'vault'),
      providerRoots: [],
    });

    await expect(validation).rejects.toThrow('Vault parent directory does not exist.');
  });

  it('writes config and creates the vault only after setup confirmation', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack');

    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex', 'claude'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
      },
    });

    await expect(stat(vaultPath)).resolves.toSatisfy((vaultStats) => vaultStats.isDirectory());
    await expect(readFile(join(vaultPath, 'config.json'), 'utf8')).resolves.toContain(
      '"providers": [',
    );
  });

  it('throws when a required settings field is missing', async () => {
    const home = await createWorkspace();
    const settingsPath = createSettingsPath(home);
    await mkdir(join(home, '.agent-session-pack'), { recursive: true });
    await writeFile(
      settingsPath,
      `${JSON.stringify({
        version: 1,
        providers: ['codex'],
        coldAfter: '7d',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
      })}\n`,
    );

    await expect(readSetupSettings(home)).rejects.toThrow('vaultPath');
  });

  it('reads old settings that omit packOnAgentExit', async () => {
    const home = await createWorkspace();
    const vaultPath = join(home, '.agent-session-pack');
    await writeSetupSettings({
      home,
      config: {
        version: 1,
        providers: ['codex'],
        vaultPath,
        coldAfter: '7d',
        createdAt: '2026-07-07T00:00:00.000Z',
        updatedAt: '2026-07-07T00:00:00.000Z',
      },
    });

    const settings = await readSetupSettings(home);

    expect(settings?.packOnAgentExit).toBeUndefined();
    expect(settings?.coldAfter).toBe('7d');
  });
});

describe('init command', () => {
  const writes: string[] = [];
  const originalStdinIsTty = process.stdin.isTTY;
  const originalStdoutIsTty = process.stdout.isTTY;

  beforeEach(() => {
    writes.length = 0;
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: originalStdinIsTty,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: originalStdoutIsTty,
    });
    vi.restoreAllMocks();
  });

  it('writes stable JSON defaults without prompting when --json is set', async () => {
    await runInitCommand({ json: true });

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument).toEqual({
      vaultPath: '~/.agent-session-pack',
      coldAfter: '7d',
      restoreCacheAfter: '7d',
      lifecycle: 'manual-proof-only',
      plannedLifecycle: 'restore-on-launch-pack-on-close',
      apply: false,
    });
  });

  it('includes apply:true in JSON when --apply is set', async () => {
    await runInitCommand({ json: true, apply: true });

    const printedDocument = JSON.parse(writes.join(''));
    expect(printedDocument.apply).toBe(true);
  });

  it('prints dry-run human defaults on non-TTY without prompts', async () => {
    await runInitCommand({});

    const printout = writes.join('');
    expect(printout).toContain('Defaults: vault ~/.agent-session-pack');
    expect(printout).toContain('Dry run only. Re-run with --apply to write config.');
    expect(printout).toContain('No files changed.');
  });
});
