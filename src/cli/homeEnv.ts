/**
 * Shared user-facing guidance when the HOME environment variable is missing.
 *
 * Agent Session Pack resolves vault, config, and provider session roots under
 * HOME. These strings stay in one place so command stderr and interactive
 * cancel paths stay consistent.
 */

/**
 * Multi-line stderr guidance for non-interactive command paths when HOME is unset.
 */
export const homeNotSetStderrMessage = [
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
export const homeNotSetCancelMessage =
  'HOME is not set. Agent Session Pack needs HOME to resolve vault and config paths (default ~/.agent-session-pack). Set HOME in your shell, or see .env.example. No files changed.';
