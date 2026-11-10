const homeNotSetStderrMessage = [
  'HOME is not set.',
  '',
  'Agent Session Pack needs HOME to resolve vault and config paths under your home directory',
  '(default: ~/.agent-session-pack). Export HOME in your shell environment.',
  'For local development notes, see .env.example — this CLI reads process.env only and does not load dotenv.',
  '',
].join('\n');

export const HOME_NOT_SET_CANCEL_MESSAGE =
  'HOME is not set. Agent Session Pack needs HOME to resolve vault and config paths (default ~/.agent-session-pack). Set HOME in your shell, or see .env.example. No files changed.';

export const requireHome = (homeOverride?: string): string | null => {
  const home = homeOverride ?? process.env.HOME;

  const isHomeMissing = home == null;
  if (isHomeMissing) {
    process.stderr.write(homeNotSetStderrMessage);
  }

  return home;
};
