import type { ProviderAdapter } from '@/session-model.js';
import { claudeCodeProvider } from './claude-code.js';
import { codexProvider } from './codex.js';
import { cursorProvider } from './cursor.js';
import { devinProvider } from './devin.js';
import { geminiProvider } from './gemini.js';
import { grokProvider } from './grok.js';
import { kimiProvider } from './kimi.js';
import { kiroProvider } from './kiro.js';
import { opencodeProvider } from './opencode.js';

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
