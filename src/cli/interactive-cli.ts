import type { CommandOutcome } from '@/command-outcome.js';
import { runDoctorCommand } from '@/doctor/command.js';
import { runSavingsCommand } from '@/evidence/savings-command.js';
import type { InteractiveCliRequest } from '@/interactive-cli-request.js';
import { runPackFlow } from '@/pack/flow.js';
import { clackPromptAdapter, type PromptAdapter, type PromptOption } from '@/prompt-adapter.js';
import { runRestoreFlow } from '@/restore/flow.js';
import { runReviewSessions } from '@/scan/review-flow.js';
import { runFirstSetup } from '@/setup/first-setup-flow.js';
import { runWithSpinner } from '@/spinner-task.js';

type MainMenuAction = 'doctor' | 'exit' | 'pack' | 'restore' | 'review' | 'savings' | 'setup';

/**
 * Inputs used to decide whether the interactive CLI should run.
 */
export type InteractiveCliDetectionRequest = {
  readonly argv: ReadonlyArray<string>;
  readonly stdinIsTty: boolean;
  readonly stdoutIsTty: boolean;
};

/**
 * Decides whether the bare binary should open the human interactive flow.
 *
 * @param request - Normalized argv and terminal state.
 * @returns True when no command or flags were provided in a TTY.
 */
export const shouldRunInteractiveCli = (request: InteractiveCliDetectionRequest): boolean => {
  const isTerminalMissing = !request.stdinIsTty || !request.stdoutIsTty;
  if (isTerminalMissing) {
    return false;
  }

  return request.argv.length <= 2;
};

/**
 * Builds the main interactive menu options with Clack hint copy.
 *
 * @returns Main menu options.
 */
export const createMainMenuOptions = (): ReadonlyArray<PromptOption<MainMenuAction>> => [
  {
    value: 'setup',
    label: 'First setup',
    hint: 'choose providers, vault path, cold threshold, and safety defaults',
  },
  {
    value: 'savings',
    label: 'Check savings',
    hint: 'copy-only proof; shows what you could save without touching sessions',
  },
  {
    value: 'review',
    label: 'Review sessions',
    hint: 'scan all providers; show dates, paths, size, cold/active status',
  },
  {
    value: 'pack',
    label: 'Pack cold sessions',
    hint: 'dry-run first; apply only after verified archive + confirmation',
  },
  {
    value: 'restore',
    label: 'Restore sessions',
    hint: 'unpack archived sessions back to native provider paths',
  },
  {
    value: 'doctor',
    label: 'Doctor',
    hint: 'check zstd, sqlite, provider roots, vault health, and config',
  },
  {
    value: 'exit',
    label: 'Exit',
    hint: 'leave without changing files',
  },
];

/**
 * Runs the full human interactive menu.
 *
 * @param request - Optional test overrides for prompts, home, providers, and time.
 * @returns Promise that resolves after the selected action completes.
 */
export const runInteractiveCli = async (
  request: InteractiveCliRequest = {},
): Promise<CommandOutcome> => {
  const prompts = request.prompts ?? clackPromptAdapter;
  prompts.intro('Agent Session Pack');
  prompts.note(firstScreenCopy());

  const action = await prompts.select({
    message: 'What do you want to do?',
    options: createMainMenuOptions(),
  });

  const isActionCancelOrExit = prompts.isCancel(action) || action === 'exit';
  if (isActionCancelOrExit) {
    prompts.outro('No files changed.');
    return { exitCode: 0 };
  }

  return runInteractiveAction({
    ...request,
    action,
    prompts,
  });
};

const runInteractiveAction = async (
  request: InteractiveCliRequest & {
    readonly action: MainMenuAction;
    readonly prompts: PromptAdapter;
  },
): Promise<CommandOutcome> => {
  const isSetupRequested = request.action === 'setup';
  if (isSetupRequested) {
    await runFirstSetup({
      ...request,
      showIntro: false,
    });
    return { exitCode: 0 };
  }

  const isSavingsRequested = request.action === 'savings';
  if (isSavingsRequested) {
    const savingsOutcome = await runWithSpinner({
      prompts: request.prompts,
      startMessage: 'Checking savings...',
      stopMessage: 'Savings check complete.',
      task: () => runSavingsCommand({}),
    });
    request.prompts.outro('Original sessions touched: no');
    return savingsOutcome;
  }

  const isReviewRequested = request.action === 'review';
  if (isReviewRequested) {
    return runReviewSessions(request);
  }

  const isPackRequested = request.action === 'pack';
  if (isPackRequested) {
    return runPackFlow(request);
  }

  const isRestoreRequested = request.action === 'restore';
  if (isRestoreRequested) {
    return runRestoreFlow(request);
  }

  return runDoctorCommand({});
};

const firstScreenCopy = (): string =>
  [
    'Compress old local AI-agent sessions without breaking resume.',
    '',
    'How it works:',
    '  1. Scans provider stores read-only',
    '  2. Proves savings on copied files first',
    '  3. Packs only cold sessions into ~/.agent-session-pack',
    '  4. Verifies byte-exact restore',
    '  5. Removes originals only after verification',
    '',
    'No daemon. No background deletion. Cursor and Devin stay backup-only for now. Grok/Kimi pack whole session directories.',
  ].join('\n');
