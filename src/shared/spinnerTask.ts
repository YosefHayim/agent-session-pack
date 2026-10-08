import type { PromptAdapter } from './promptAdapter.js';

/**
 * Inputs for running an async task under a TTY spinner.
 */
export type SpinnerTaskRequest<Value> = {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Value>;
};

/**
 * Runs a promise-backed task under a TTY spinner with start/stop/error messages.
 *
 * @param request - Spinner messages, prompt adapter, and async task.
 * @returns Task result after a successful stop message.
 * @example
 * ```ts
 * import { runWithSpinner } from './spinnerTask.js';
 * import { clackPromptAdapter } from './promptAdapter.js';
 *
 * const value = await runWithSpinner({
 *   prompts: clackPromptAdapter,
 *   startMessage: 'Working...',
 *   stopMessage: 'Done.',
 *   task: async () => 42,
 * });
 * ```
 */
export const runWithSpinner = async <Value>(request: SpinnerTaskRequest<Value>): Promise<Value> => {
  const scanSpinner = request.prompts.spinner();
  scanSpinner.start(request.startMessage);

  try {
    const value = await request.task();
    scanSpinner.stop(request.stopMessage);
    return value;
  } catch (cause) {
    scanSpinner.error('Operation failed.');
    throw cause;
  }
};
