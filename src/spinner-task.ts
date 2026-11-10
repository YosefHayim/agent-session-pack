import type { PromptAdapter } from './prompt-adapter.js';

export type SpinnerTaskRequest<Produced> = {
  readonly prompts: PromptAdapter;
  readonly startMessage: string;
  readonly stopMessage: string;
  readonly task: () => Promise<Produced>;
};

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
