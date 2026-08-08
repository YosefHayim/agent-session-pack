import { Effect } from 'effect';
import { runDoctorCommand } from './commands/doctorCommand.js';
import { runSavingsCommand } from './commands/savingsCommand.js';
import { runFirstSetup } from './firstSetupFlow.js';
import {
  type InteractiveCliDetectionRequest,
  type InteractiveCliRequest,
  normalizePrompts,
  runWithSpinner,
} from './interactiveCliContext.js';
import { runPackFlow, runRestoreFlow, runReviewSessions } from './interactiveSessionFlows.js';
import type { PromptAdapter, PromptOption } from './promptAdapter.js';

/**
 * Re-exports the first-setup wizard for init and menu entrypoints.
 */
export { runFirstSetup } from './firstSetupFlow.js';
/**
 * Re-exports interactive request types for callers and tests.
 */
export type {
  FirstSetupRequest,
  InteractiveCliDetectionRequest,
  InteractiveCliRequest,
} from './interactiveCliContext.js';
/**
 * Re-exports prompt adapter types for test doubles and menu option typing.
 */
export type { PromptAdapter, PromptOption, PromptSpinner } from './promptAdapter.js';
/**
 * Re-exports the Clack-backed prompt adapter for production TTY flows.
 */
export { clackPromptAdapter } from './promptAdapter.js';

type MainMenuAction = 'doctor' | 'exit' | 'pack' | 'restore' | 'review' | 'savings' | 'setup';

/**
 * Decides whether the bare binary should open the human interactive flow.
 *
 * @param request - Normalized argv and terminal state.
 * @returns True when no command or flags were provided in a TTY.
 * @example
 * ```ts
 * import { shouldRunInteractiveCli } from './interactiveCli.js';
 *
 * const interactive = shouldRunInteractiveCli({
 *   argv: ['node', 'cli.js'],
 *   stdinIsTty: true,
 *   stdoutIsTty: true,
 * });
 * ```
 */
export const shouldRunInteractiveCli = (request: InteractiveCliDetectionRequest): boolean => {
  if (!request.stdinIsTty || !request.stdoutIsTty) {
    return false;
  }

  return request.argv.length <= 2;
};

/**
 * Builds the main interactive menu options with Clack hint copy.
 *
 * @returns Main menu options.
 * @example
 * ```ts
 * import { createMainMenuOptions } from './interactiveCli.js';
 *
 * const options = createMainMenuOptions();
 * ```
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
 * @example
 * ```ts
 * import { runInteractiveCli } from './interactiveCli.js';
 *
 * await runInteractiveCli();
 * ```
 */
export const runInteractiveCli = async (request: InteractiveCliRequest = {}): Promise<void> => {
  const prompts = normalizePrompts(request.prompts);
  prompts.intro('Agent Session Pack');
  prompts.note(firstScreenCopy());

  const action = await prompts.select({
    message: 'What do you want to do?',
    options: createMainMenuOptions(),
  });

  if (prompts.isCancel(action) || action === 'exit') {
    prompts.outro('No files changed.');
    return;
  }

  await runInteractiveAction({
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
): Promise<void> => {
  if (request.action === 'setup') {
    await runFirstSetup({
      ...request,
      showIntro: false,
    });
    return;
  }

  if (request.action === 'savings') {
    await runWithSpinner({
      prompts: request.prompts,
      startMessage: 'Checking savings...',
      stopMessage: 'Savings check complete.',
      task: () => Effect.runPromise(runSavingsCommand({})),
    });
    request.prompts.outro('Original sessions touched: no');
    return;
  }

  if (request.action === 'review') {
    await runReviewSessions(request);
    return;
  }

  if (request.action === 'pack') {
    await runPackFlow(request);
    return;
  }

  if (request.action === 'restore') {
    await runRestoreFlow(request);
    return;
  }

  await runDoctorCommand({});
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
