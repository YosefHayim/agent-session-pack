import type { PromptAdapter } from './promptAdapter.js';
import type { ProviderAdapter } from './sessionModel.js';

/**
 * Optional overrides for the interactive CLI menu.
 */
export type InteractiveCliRequest = {
  readonly home?: string;
  readonly now?: Date;
  readonly olderThanMs?: number;
  readonly prompts?: PromptAdapter;
  readonly providers?: ReadonlyArray<ProviderAdapter>;
};
