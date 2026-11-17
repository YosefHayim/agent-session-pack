import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { devinProvider } from './devin.js';
import { discoverDirectoryProviderSessions } from './directory-sessions.js';
import { grokProvider } from './grok.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';
import { kimiProvider } from './kimi.js';

export const claudeCodeProvider: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.claude', 'projects')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'claude',
      store,
      excludePathParts: ['subagents'],
    }),
};

export const codexProvider: ProviderAdapter = {
  id: 'codex',
  label: 'Codex',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.codex', 'sessions')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'codex',
      store,
      excludePathParts: [],
    }),
};

const cursorProvider: ProviderAdapter = {
  id: 'cursor',
  label: 'Cursor',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, 'Library', 'Application Support', 'Cursor'),
  ],
  discover: async () => [],
};

const kiroProvider: ProviderAdapter = {
  id: 'kiro',
  label: 'Kiro',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.kiro', 'sessions')],
  discover: (store) =>
    discoverJsonlProviderSessions({
      provider: 'kiro',
      store,
      excludePathParts: [],
    }),
};

const geminiProvider: ProviderAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.gemini'),
    join(home, '.gemini', 'tmp'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'gemini',
      store,
      markers: ['checkpoint.json', 'chat.json', 'session.json', 'history.json'],
      maxDepth: 5,
      excludedNames: ['bin', 'node_modules', 'extensions'],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'gemini',
      store,
      excludePathParts: ['bin', 'node_modules', 'extensions'],
    });
  },
};

const opencodeProvider: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'opencode'),
    join(home, '.opencode'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'opencode',
      store,
      markers: ['session.json', 'info.json', 'meta.json'],
      maxDepth: 6,
      excludedNames: ['log', 'logs', 'bin', 'node_modules'],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'opencode',
      store,
      excludePathParts: ['log', 'logs', 'node_modules'],
    });
  },
};

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
