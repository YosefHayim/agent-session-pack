import { describe, expect, it } from 'vitest';
import { isCliEntrypoint } from '../src/cli/mainEntrypoint.js';

describe('CLI entrypoint detection', () => {
  it('accepts npm bin symlinks that resolve to the built module path', () => {
    const realpath = (path: string): string => {
      if (path === '/prefix/bin/agent-session-pack') {
        return '/package/dist/cli/main.js';
      }

      return path;
    };

    expect(
      isCliEntrypoint('/prefix/bin/agent-session-pack', '/package/dist/cli/main.js', realpath),
    ).toBe(true);
  });
});
