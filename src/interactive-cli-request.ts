import type { PromptAdapter } from './prompt-adapter.js';
import type { ProviderAdapter } from './session-model.js';

export interface InteractiveCliRequest {
  readonly home?: string;
  readonly now?: Date;
  readonly olderThanMs?: number;
  readonly prompts?: PromptAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
}
