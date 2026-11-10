import type { PromptAdapter } from './prompt-adapter.js';

/**
 * Inputs for running an async task under a TTY spinner.
 */
export type SpinnerTaskRequest<Produced> = {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Produced>;
};

/**
 * Runs a promise-backed task under a TTY spinner with start/stop/error messages.
 *
 * @param request - Spinner messages, prompt adapter, and async task.
 * @returns Task result after a successful stop message.
 * @example
 * ```ts
 * import { runWithSpinner } from './spinner-task.js';
 * import { clackPromptAdapter } from './prompt-adapter.js';
 *
 * const value = await runWithSpinner({
 *   prompts: clackPromptAdapter,
 *   startMessage: 'Working...',
 *   stopMessage: 'Done.',
 *   task: async () => 42,
 * });
 * ```
 */
export const runWithSpinner = async <Produced>(
  request: SpinnerTaskRequest<Produced>,
): Promise<Produced> => {
  const scanSpinner = request.prompts.spinner();
  scanSpinner.start(request.startMessage);

  try {
    const produced = await request.task();
    scanSpinner.stop(request.stopMessage);
    return produced;
  } catch (cause) {
    scanSpinner.error('Operation failed.');
    throw cause;
  }
};
