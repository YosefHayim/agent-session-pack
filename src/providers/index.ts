import type { ProviderAdapter } from '../core/index.js';
import { claudeCodeProvider } from './claudeCode.js';
import { codexProvider } from './codex.js';
import { cursorProvider } from './cursor.js';
import { devinProvider } from './devin.js';
import { kiroProvider } from './kiro.js';

export { type ProviderId, ProviderIdSchema } from '../core/index.js';
export * from './claudeCode.js';
export * from './codex.js';
export * from './cursor.js';
export * from './devin.js';
export * from './kiro.js';

export const allProviders: ReadonlyArray<ProviderAdapter> = [
  codexProvider,
  claudeCodeProvider,
  kiroProvider,
  cursorProvider,
  devinProvider,
];
