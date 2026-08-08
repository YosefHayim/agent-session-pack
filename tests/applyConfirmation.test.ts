import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveApplyConfirmation } from '../src/cli/applyConfirmation.js';

describe('apply confirmation contract', () => {
  const originalStdinIsTty = process.stdin.isTTY;
  const originalStdoutIsTty = process.stdout.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: false,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      configurable: true,
      value: false,
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

  it('returns undefined when apply is not requested', async () => {
    await expect(
      resolveApplyConfirmation({
        action: 'Pack cold sessions',
        apply: undefined,
        json: true,
        yes: undefined,
      }),
    ).resolves.toBeUndefined();
  });

  it('returns true for --apply --yes without prompting', async () => {
    await expect(
      resolveApplyConfirmation({
        action: 'Pack cold sessions',
        apply: true,
        json: false,
        yes: true,
      }),
    ).resolves.toBe(true);
  });

  it('returns false for --apply --json without --yes (no-prompt contract)', async () => {
    await expect(
      resolveApplyConfirmation({
        action: 'Pack cold sessions',
        apply: true,
        json: true,
        yes: undefined,
      }),
    ).resolves.toBe(false);
  });

  it('returns false for --apply on non-TTY without --yes', async () => {
    await expect(
      resolveApplyConfirmation({
        action: 'Restore archived sessions',
        apply: true,
        json: undefined,
        yes: undefined,
      }),
    ).resolves.toBe(false);
  });
});
