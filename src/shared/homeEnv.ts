/**
 * Shared user-facing guidance when the HOME environment variable is missing.
 *
 * Agent Session Pack resolves vault, config, and provider session roots under
 * HOME. These strings stay in one place so command stderr and interactive
 * cancel paths stay consistent.
 */

const HOME_NOT_SET_STDERR_MESSAGE = [
  'HOME is not set.',
  '',
  'Agent Session Pack needs HOME to resolve vault and config paths under your home directory',
  '(default: ~/.agent-session-pack). Export HOME in your shell environment.',
  'For local development notes, see .env.example — this CLI reads process.env only and does not load dotenv.',
  '',
].join('\n');

/**
 * Interactive cancel guidance when HOME is unset.
 */
export const HOME_NOT_SET_CANCEL_MESSAGE =
  'HOME is not set. Agent Session Pack needs HOME to resolve vault and config paths (default ~/.agent-session-pack). Set HOME in your shell, or see .env.example. No files changed.';

/**
 * Resolves the home directory for a command, or reports the missing HOME and sets exit code 1.
 *
 * @param homeOverride - Optional `--home` value that wins over `process.env.HOME`.
 * @returns The home directory, or undefined after the guidance was written to stderr.
 * @example
 * ```ts
 * import { requireHome } from './homeEnv.js';
 *
 * const home = requireHome(args.home);
 * ```
 */
export const requireHome = (homeOverride?: string): string | undefined => {
  const home = homeOverride ?? process.env.HOME;

  if (home === undefined) {
    process.stderr.write(HOME_NOT_SET_STDERR_MESSAGE);
    process.exitCode = 1;
  }

  return home;
};
