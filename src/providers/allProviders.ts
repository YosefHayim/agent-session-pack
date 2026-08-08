import type { ProviderAdapter } from '../core/sessionStore.js';
import { claudeCodeProvider } from './claudeCode.js';
import { codexProvider } from './codex.js';
import { cursorProvider } from './cursor.js';
import { devinProvider } from './devin.js';
import { geminiProvider } from './gemini.js';
import { grokProvider } from './grok.js';
import { kimiProvider } from './kimi.js';
import { kiroProvider } from './kiro.js';
import { opencodeProvider } from './opencode.js';

/**
 * All registered provider adapters in discovery order.
 */
export const allProviders: ReadonlyArray<ProviderAdapter> = [
  codexProvider,
  claudeCodeProvider,
  kiroProvider,
  grokProvider,
  kimiProvider,
  opencodeProvider,
  geminiProvider,
  cursorProvider,
  devinProvider,
];
