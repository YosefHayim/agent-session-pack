import { join } from 'node:path';
import type { ProviderAdapter } from '@/session-model.js';
import { devinProvider } from './devin.js';
import { discoverDirectoryProviderSessions } from './directory-sessions.js';
import { grokProvider } from './grok.js';
import { discoverJsonlProviderSessions } from './jsonl-sessions.js';
import { kimiProvider } from './kimi.js';

const ARCHIVE_MODE = 'archive';
const SESSIONS_FOLDER_NAME = 'sessions';
const SESSION_FILE_NAME = 'session.json';
const BIN_FOLDER_NAME = 'bin';
const NODE_MODULES_FOLDER_NAME = 'node_modules';
const EXTENSIONS_FOLDER_NAME = 'extensions';
const LOG_FOLDER_NAME = 'log';
const LOGS_FOLDER_NAME = 'logs';
const GEMINI_FOLDER_NAME = '.gemini';
const geminiMaxDepth = 5;
const opencodeMaxDepth = 6;

export const claudeCodeProvider: ProviderAdapter = {
  id: 'claude',
  label: 'Claude Code',
  mode: ARCHIVE_MODE,
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
  mode: ARCHIVE_MODE,
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.codex', SESSIONS_FOLDER_NAME),
  ],
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
  mode: ARCHIVE_MODE,
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.kiro', SESSIONS_FOLDER_NAME),
  ],
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
  mode: ARCHIVE_MODE,
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, GEMINI_FOLDER_NAME),
    join(home, GEMINI_FOLDER_NAME, 'tmp'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'gemini',
      store,
      markers: ['checkpoint.json', 'chat.json', SESSION_FILE_NAME, 'history.json'],
      maxDepth: geminiMaxDepth,
      excludedNames: [BIN_FOLDER_NAME, NODE_MODULES_FOLDER_NAME, EXTENSIONS_FOLDER_NAME],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'gemini',
      store,
      excludePathParts: [BIN_FOLDER_NAME, NODE_MODULES_FOLDER_NAME, EXTENSIONS_FOLDER_NAME],
    });
  },
};

const opencodeProvider: ProviderAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  mode: ARCHIVE_MODE,
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'opencode'),
    join(home, '.opencode'),
  ],
  discover: async (store) => {
    const directorySessions = await discoverDirectoryProviderSessions({
      provider: 'opencode',
      store,
      markers: [SESSION_FILE_NAME, 'info.json', 'meta.json'],
      maxDepth: opencodeMaxDepth,
      excludedNames: [LOG_FOLDER_NAME, LOGS_FOLDER_NAME, BIN_FOLDER_NAME, NODE_MODULES_FOLDER_NAME],
    });

    const isDirectorySessionFound = directorySessions.length > 0;

    if (isDirectorySessionFound) {
      return directorySessions;
    }

    return discoverJsonlProviderSessions({
      provider: 'opencode',
      store,
      excludePathParts: [LOG_FOLDER_NAME, LOGS_FOLDER_NAME, NODE_MODULES_FOLDER_NAME],
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
