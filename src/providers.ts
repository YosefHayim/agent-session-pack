import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { createReadStream, type Dirent, type Stats } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';

const PROVIDER_IDS = [
  'codex',
  'claude',
  'kiro',
  'cursor',
  'devin',
  'grok',
  'kimi',
  'opencode',
  'gemini',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type SessionOriginKind = 'file' | 'directory';

export type ProviderMode = 'archive' | 'backup-only';

type SessionStatus = 'live' | 'cold' | 'archived' | 'restored' | 'pinned' | 'quarantined';

export interface DiscoveredSession {
  readonly id: string;
  readonly provider: ProviderId;
  readonly title: string;
  readonly slug: string;
  readonly originalPath: string;
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
  readonly sourceKind?: SessionOriginKind;
  readonly createdAt?: Date;
  readonly status?: SessionStatus;
  readonly archivePath?: string;
  readonly savedPercent?: number;
}

export interface SessionStore {
  readonly provider: ProviderId;
  readonly path: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (store: SessionStore) => Promise<ReadonlyArray<DiscoveredSession>>;
}

export function readProviderId(word: string): ProviderId | null {
  for (const providerId of PROVIDER_IDS) {
    if (providerId == word) {
      return providerId;
    }
  }

  return null;
}

export function readSessionOriginKind(word: string): SessionOriginKind | null {
  if (word == 'file') {
    return 'file';
  }

  if (word == 'directory') {
    return 'directory';
  }

  return null;
}

const BYTES_PER_KIBIBYTE = 1024;

// Catches a UUID such as 123e4567-e89b-12d3-a456-426614174000 inside a name.
export const SESSION_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

interface SessionFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
}

export interface CollectJsonlSettings {
  readonly excludePathParts: ReadonlyArray<string>;
}

export async function collectJsonlSessions(
  root: string,
  settings: CollectJsonlSettings,
): Promise<ReadonlyArray<SessionFile>> {
  async function readDirents(directory: string) {
    try {
      return await readdir(directory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Could not read session files in ${directory}`, { cause: error });
    }
  }

  async function readFileStat(filePath: string) {
    try {
      return await stat(filePath);
    } catch (error) {
      throw new Error(`Could not read session files in ${filePath}`, { cause: error });
    }
  }

  const dirents = await readDirents(root);
  const files: SessionFile[] = [];

  for (const dirent of dirents) {
    if (settings.excludePathParts.includes(dirent.name)) {
      continue;
    }

    const childPath = join(root, dirent.name);

    const isChildDirectory = dirent.isDirectory();
    if (isChildDirectory) {
      files.push(...(await collectJsonlSessions(childPath, settings)));
      continue;
    }

    const isNotFile = !dirent.isFile();
    if (isNotFile) {
      continue;
    }

    if (!dirent.name.endsWith('.jsonl')) {
      continue;
    }

    const fileStat = await readFileStat(childPath);

    files.push({
      path: childPath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime,
    });
  }

  return files;
}

export async function measureDirectorySession(path: string): Promise<SessionFile> {
  try {
    const rootStat = await stat(path);
    let sizeBytes = 0;
    let modifiedAt = rootStat.mtime;

    async function walk(directory: string): Promise<void> {
      const dirents = await readdir(directory, { withFileTypes: true });

      for (const dirent of dirents) {
        const childPath = join(directory, dirent.name);

        const isChildDirectory = dirent.isDirectory();
        if (isChildDirectory) {
          await walk(childPath);
          continue;
        }

        const isNotFile = !dirent.isFile();
        if (isNotFile) {
          continue;
        }

        const fileStat = await stat(childPath);
        sizeBytes += fileStat.size;

        if (fileStat.mtime.getTime() > modifiedAt.getTime()) {
          modifiedAt = fileStat.mtime;
        }
      }
    }

    await walk(path);

    return {
      path,
      sizeBytes,
      modifiedAt,
    };
  } catch (error) {
    throw new Error(`Could not measure session directory ${path}`, { cause: error });
  }
}

export function slugifyTitle(title: string): string {
  // Catches each run of characters that are not letters or digits.
  const nonAlphanumericRuns = /[^a-z0-9]+/g;
  // Catches dashes at the start or the end of the slug.
  const edgeDashes = /^-+|-+$/g;
  const slug = title.toLowerCase().replace(nonAlphanumericRuns, '-').replace(edgeDashes, '');

  if (slug.length == 0) {
    return 'untitled-session';
  }

  return slug;
}

export function readSessionIdFromPath(path: string): string {
  const fileName = basename(path, extname(path));
  const idHit = fileName.match(SESSION_UUID_PATTERN);

  if (idHit != null) {
    return idHit[0];
  }

  return fileName;
}

export function readSessionTitle(path: string): Promise<string> {
  return readSessionTitleFromFile(path);
}

async function readSessionTitleFromFile(path: string): Promise<string> {
  try {
    let carry = '';
    let bytesRead = 0;
    const stream = createReadStream(path, {
      encoding: 'utf8',
      highWaterMark: 64 * BYTES_PER_KIBIBYTE,
    });

    for await (const chunk of stream) {
      const chunkString = streamChunkToString(chunk);
      bytesRead += Buffer.byteLength(chunkString, 'utf8');

      const titleScan = readTitleFromDelimitedLines(`${carry}${chunkString}`);

      if (titleScan.title.length > 0) {
        stream.destroy();
        return titleScan.title;
      }

      carry = titleScan.rest;

      if (bytesRead >= BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE) {
        stream.destroy();
        return basename(path, extname(path));
      }
    }

    const lastTitle = readTitleFromJsonlLine(carry);

    const hasTitle = lastTitle.length > 0;
    if (hasTitle) {
      return lastTitle;
    }

    return basename(path, extname(path));
  } catch (error) {
    throw new Error(`Could not read session title ${path}`, { cause: error });
  }
}

function streamChunkToString(chunk: string | Buffer): string {
  if (typeof chunk == 'string') {
    return chunk;
  }

  return chunk.toString('utf8');
}

function readTitleFromDelimitedLines(fileString: string): {
  readonly title: string;
  readonly rest: string;
} {
  // Catches a line break in Unix or Windows form.
  const lineBreak = /\r?\n/;
  const lines = fileString.split(lineBreak);
  const rest = lines.pop();

  if (rest == null) {
    return {
      title: '',
      rest: '',
    };
  }

  for (const line of lines) {
    const title = readTitleFromJsonlLine(line);

    const hasTitle = title.length > 0;
    if (hasTitle) {
      return {
        title,
        rest,
      };
    }
  }

  return {
    title: '',
    rest,
  };
}

function readTitleFromJsonlLine(line: string): string {
  try {
    const event: unknown = JSON.parse(line);

    if (!isJsonObject(event)) {
      return '';
    }

    if (event.type != 'user') {
      return '';
    }

    const eventText = event.text;
    if (typeof eventText == 'string') {
      return eventText;
    }

    const eventMessage = event.message;
    if (!isJsonObject(eventMessage)) {
      return '';
    }

    const messageContent = eventMessage.content;
    if (typeof messageContent == 'string') {
      return messageContent;
    }

    return '';
  } catch {
    return '';
  }
}

export function isJsonObject(candidate: unknown): candidate is Readonly<Record<string, unknown>> {
  const isObjectType = typeof candidate == 'object';
  const isNotNull = candidate != null;

  return isObjectType && isNotNull;
}

export interface JsonlProviderDiscoverySettings {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly excludePathParts: ReadonlyArray<string>;
}

export async function discoverJsonlProviderSessions(
  settings: JsonlProviderDiscoverySettings,
): Promise<ReadonlyArray<DiscoveredSession>> {
  const files = await collectJsonlSessions(settings.store.path, {
    excludePathParts: settings.excludePathParts,
  });
  const sessions: DiscoveredSession[] = [];

  for (const file of files) {
    const title = await readSessionTitle(file.path);
    sessions.push(
      readSessionFromFile({
        provider: settings.provider,
        path: file.path,
        title,
        sizeBytes: file.sizeBytes,
        modifiedAt: file.modifiedAt,
      }),
    );
  }

  return sessions;
}

function readSessionFromFile(file: {
  readonly provider: ProviderId;
  readonly path: string;
  readonly title: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
}): DiscoveredSession {
  return {
    id: readSessionIdFromPath(file.path),
    provider: file.provider,
    title: file.title,
    slug: slugifyTitle(file.title),
    originalPath: file.path,
    modifiedAt: file.modifiedAt,
    sizeBytes: file.sizeBytes,
    sourceKind: 'file',
    status: 'live',
  };
}

type DirectorySessionMarkers = ReadonlyArray<string>;

export interface DirectoryProviderDiscoverySettings {
  readonly provider: ProviderId;
  readonly store: SessionStore;
  readonly markers: DirectorySessionMarkers;
  readonly maxDepth: number;
  readonly excludedNames?: ReadonlyArray<string>;
  readonly activeSessionIds?: ReadonlySet<string>;
  readonly titleFromDirectory?: (path: string) => Promise<string>;
  readonly sessionIdFromDirectory?: (path: string) => string;
}

export async function discoverDirectoryProviderSessions(
  settings: DirectoryProviderDiscoverySettings,
): Promise<ReadonlyArray<DiscoveredSession>> {
  const directories = await collectSessionDirectories(settings.store.path, {
    markers: settings.markers,
    maxDepth: settings.maxDepth,
    excludedNames: settings.excludedNames ?? [],
  });
  const sessions: DiscoveredSession[] = [];

  for (const directory of directories) {
    const sessionId =
      settings.sessionIdFromDirectory?.(directory) ?? readDefaultSessionIdFromDirectory(directory);

    if (settings.activeSessionIds?.has(sessionId) == true) {
      continue;
    }

    const measuredSession = await measureDirectorySession(directory);
    const title = await readDirectoryTitle({
      directory,
      sessionId,
      titleFromDirectory: settings.titleFromDirectory,
    });

    sessions.push({
      id: sessionId,
      provider: settings.provider,
      title,
      slug: slugifyTitle(title),
      originalPath: directory,
      modifiedAt: measuredSession.modifiedAt,
      sizeBytes: measuredSession.sizeBytes,
      sourceKind: 'directory',
      status: 'live',
    });
  }

  return sessions;
}

export async function readDocumentFile(path: string): Promise<unknown | null> {
  try {
    const fileString = await readFile(path, 'utf8');
    return JSON.parse(fileString) as unknown;
  } catch {
    return null;
  }
}

async function readDirectoryTitle(request: {
  readonly directory: string;
  readonly sessionId: string;
  readonly titleFromDirectory?: (path: string) => Promise<string>;
}): Promise<string> {
  const titleFromDirectory = request.titleFromDirectory;
  if (titleFromDirectory == null) {
    return request.sessionId;
  }

  try {
    const titleFound = await titleFromDirectory(request.directory);

    const isTitleFound = titleFound.length > 0;
    return isTitleFound ? titleFound : request.sessionId;
  } catch {
    return request.sessionId;
  }
}

function readDefaultSessionIdFromDirectory(path: string): string {
  const name = basename(path);
  const uuidHit = name.match(SESSION_UUID_PATTERN);

  if (uuidHit != null) {
    return uuidHit[0];
  }

  return name;
}

async function collectSessionDirectories(
  root: string,
  settings: {
    readonly markers: DirectorySessionMarkers;
    readonly maxDepth: number;
    readonly excludedNames: ReadonlyArray<string>;
  },
): Promise<ReadonlyArray<string>> {
  const isRootDirectory = await isDirectoryPath(root);
  if (!isRootDirectory) {
    return [];
  }

  const found: string[] = [];

  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > settings.maxDepth) {
      return;
    }

    if (await hasDirectoryMarkers(directory, settings.markers)) {
      found.push(directory);
      return;
    }

    if (depth == settings.maxDepth) {
      return;
    }

    const childDirents = await readChildDirents(directory);

    for (const dirent of childDirents) {
      if (!dirent.isDirectory()) {
        continue;
      }

      if (settings.excludedNames.includes(dirent.name)) {
        continue;
      }

      if (dirent.name.startsWith('.')) {
        continue;
      }

      await walk(join(directory, dirent.name), depth + 1);
    }
  }

  await walk(root, 0);
  return found;
}

async function readChildDirents(directory: string): Promise<ReadonlyArray<Dirent>> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function isDirectoryPath(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isDirectory();
  } catch {
    return false;
  }
}

async function isFilePath(path: string): Promise<boolean> {
  try {
    const pathStat = await stat(path);
    return pathStat.isFile();
  } catch {
    return false;
  }
}

async function hasDirectoryMarkers(
  directory: string,
  markers: DirectorySessionMarkers,
): Promise<boolean> {
  for (const marker of markers) {
    const markerPath = join(directory, marker);

    if (await isFilePath(markerPath)) {
      return true;
    }
  }

  return false;
}

const GROK_PROVIDER_ID = 'grok';
const SUMMARY_FILE_NAME = 'summary.json';
const grokMaxDepth = 3;

export const grokProvider: ProviderAdapter = {
  id: GROK_PROVIDER_ID,
  label: 'Grok',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.grok', 'sessions')],
  discover: async (store) => {
    const activeSessionIds = await readActiveGrokSessionIds(
      join(store.path, '..', 'active_sessions.json'),
    );

    return discoverDirectoryProviderSessions({
      provider: GROK_PROVIDER_ID,
      store,
      markers: [SUMMARY_FILE_NAME, 'updates.jsonl', 'events.jsonl'],
      maxDepth: grokMaxDepth,
      activeSessionIds,
      titleFromDirectory: readGrokSessionTitle,
      sessionIdFromDirectory: basename,
    });
  },
};

function readSessionIdOrNull(summaryPart: unknown): string | null {
  if (!isJsonObject(summaryPart)) {
    return null;
  }

  const sessionId = summaryPart.session_id;
  const isSessionIdString = typeof sessionId == 'string';

  return isSessionIdString ? sessionId : null;
}

function isSessionIdFound(sessionId: string | null): sessionId is string {
  return sessionId != null;
}

async function readActiveGrokSessionIds(path: string): Promise<ReadonlySet<string>> {
  try {
    const fileString = await readFile(path, 'utf8');
    const parsedFile = JSON.parse(fileString) as unknown;

    if (!Array.isArray(parsedFile)) {
      return new Set();
    }

    const ids = parsedFile.map(readSessionIdOrNull).filter(isSessionIdFound);

    return new Set(ids);
  } catch {
    return new Set();
  }
}

function readNonBlankString(candidate: unknown): string | null {
  if (typeof candidate != 'string') {
    return null;
  }

  if (candidate.trim().length == 0) {
    return null;
  }

  return candidate;
}

async function readGrokSessionTitle(directory: string): Promise<string> {
  const summary = await readDocumentFile(join(directory, SUMMARY_FILE_NAME));

  if (!isJsonObject(summary)) {
    return basename(directory);
  }

  const sessionSummary = readNonBlankString(summary.session_summary);
  if (sessionSummary != null) {
    return sessionSummary.trim();
  }

  const info = summary.info;
  const infoCwd = isJsonObject(info) ? info.cwd : null;
  const agentName = readNonBlankString(summary.agent_name);
  if (agentName != null) {
    const isCwdString = typeof infoCwd == 'string';
    const cwdName = isCwdString ? basename(infoCwd) : basename(directory);
    return `${agentName} @ ${cwdName}`;
  }

  const nonBlankCwd = readNonBlankString(infoCwd);
  if (nonBlankCwd != null) {
    return basename(nonBlankCwd);
  }

  return basename(directory);
}

const KIMI_PROVIDER_ID = 'kimi';
const STATE_FILE_NAME = 'state.json';
const SESSION_DIRECTORY_PREFIX = 'session_';
const kimiMaxDepth = 3;

export const kimiProvider: ProviderAdapter = {
  id: KIMI_PROVIDER_ID,
  label: 'Kimi Code',
  mode: 'archive',
  defaultRoots: (home: string): ReadonlyArray<string> => [join(home, '.kimi-code', 'sessions')],
  discover: (store) =>
    discoverDirectoryProviderSessions({
      provider: KIMI_PROVIDER_ID,
      store,
      markers: [STATE_FILE_NAME],
      maxDepth: kimiMaxDepth,
      titleFromDirectory: readKimiSessionTitle,
      sessionIdFromDirectory: readKimiSessionId,
    }),
};

function readKimiSessionId(path: string): string {
  const name = basename(path);
  const isNameStartsWithSession = name.startsWith(SESSION_DIRECTORY_PREFIX);

  return isNameStartsWithSession ? name.slice(SESSION_DIRECTORY_PREFIX.length) : name;
}

async function readKimiSessionTitle(directory: string): Promise<string> {
  const kimiSessionDocument = await readDocumentFile(join(directory, STATE_FILE_NAME));

  if (!isJsonObject(kimiSessionDocument)) {
    return basename(directory);
  }

  const title = kimiSessionDocument.title;
  if (typeof title != 'string') {
    return basename(directory);
  }

  const trimmedTitle = title.trim();
  if (trimmedTitle.length > 0) {
    return trimmedTitle;
  }

  return basename(directory);
}

const execFileAsync = promisify(execFile);

const DEVIN_PROVIDER_ID = 'devin';
const LIVE_SESSION_STATUS = 'live';

interface DevinSessionSummary {
  readonly id: string;
  readonly title: string;
  readonly createdAt: number;
  readonly modifiedAt: number;
  readonly sizeBytes: number;
}

export const devinProvider: ProviderAdapter = {
  id: DEVIN_PROVIDER_ID,
  label: 'Devin',
  mode: 'backup-only',
  defaultRoots: (home: string): ReadonlyArray<string> => [
    join(home, '.local', 'share', 'devin', 'cli'),
  ],
  discover: (store) => discoverDevinSessions(store.path),
};

async function discoverDevinSessions(root: string): Promise<ReadonlyArray<DiscoveredSession>> {
  const dbPath = join(root, 'sessions.db');
  const dbStat = await readStatOrNull(dbPath);

  if (dbStat == null) {
    return [];
  }

  const devinSessionSummaries = await readDevinSessions(dbPath);

  const databaseBytes = dbStat.size;
  if (devinSessionSummaries.length == 0) {
    return [readSessionFromDatabaseSnapshot(dbPath, databaseBytes, dbStat.mtime)];
  }

  function readSessionFromSummary(devinSessionSummary: DevinSessionSummary): DiscoveredSession {
    return readSessionFromDevin(devinSessionSummary, dbPath, databaseBytes);
  }

  return devinSessionSummaries.map(readSessionFromSummary);
}

async function readStatOrNull(path: string): Promise<Stats | null> {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

function readDevinSessionSummaries(parsed: unknown): ReadonlyArray<DevinSessionSummary> {
  if (Array.isArray(parsed) == false) {
    return [];
  }

  const summaries: DevinSessionSummary[] = [];

  for (const candidate of parsed) {
    const summary = readDevinSessionSummary(candidate);
    if (summary == null) {
      return [];
    }

    summaries.push(summary);
  }

  return summaries;
}

function readDevinSessionSummary(candidate: unknown): DevinSessionSummary | null {
  if (typeof candidate != 'object') {
    return null;
  }

  if (candidate == null) {
    return null;
  }

  const isArray = Array.isArray(candidate);

  if (isArray) {
    return null;
  }

  const summaryFields = candidate as Record<string, unknown>;
  const id = readDevinString(summaryFields.id);
  const title = readDevinString(summaryFields.title);
  const createdAt = readDevinNumber(summaryFields.createdAt);
  const modifiedAt = readDevinNumber(summaryFields.modifiedAt);
  const sizeBytes = readDevinNumber(summaryFields.sizeBytes);
  if (id == null) {
    return null;
  }

  if (title == null) {
    return null;
  }

  if (createdAt == null) {
    return null;
  }

  if (modifiedAt == null) {
    return null;
  }

  if (sizeBytes == null) {
    return null;
  }

  return {
    id,
    title,
    createdAt,
    modifiedAt,
    sizeBytes,
  };
}

function readDevinString(field: unknown): string | null {
  if (typeof field != 'string') {
    return null;
  }

  return field;
}

function readDevinNumber(field: unknown): number | null {
  if (typeof field != 'number') {
    return null;
  }

  if (Number.isFinite(field) == false) {
    return null;
  }

  return field;
}

async function readDevinSessions(dbPath: string): Promise<ReadonlyArray<DevinSessionSummary>> {
  try {
    const printout = await execFileAsync('sqlite3', [
      '-json',
      dbPath,
      `
SELECT
  s.id AS id,
  COALESCE(NULLIF(TRIM(s.title), ''), s.id) AS title,
  s.created_at AS createdAt,
  s.last_activity_at AS modifiedAt,
  CAST(
    COALESCE((SELECT SUM(LENGTH(content)) FROM prompt_history WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(chat_message) + LENGTH(COALESCE(metadata, ''))) FROM message_nodes WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(rendered_html)) FROM rendered_commits WHERE session_id = s.id), 0) +
    COALESCE((SELECT SUM(LENGTH(COALESCE(tool_call_json, '')) + LENGTH(COALESCE(tool_call_update_json, ''))) FROM tool_call_state WHERE session_id = s.id), 0)
    AS INTEGER
  ) AS sizeBytes
FROM sessions s
WHERE s.hidden = 0
ORDER BY s.last_activity_at DESC
`,
    ]);
    const parsedPrintout = JSON.parse(printout.stdout) as unknown;
    return readDevinSessionSummaries(parsedPrintout);
  } catch {
    return [];
  }
}

function readSessionFromDevin(
  devinSessionSummary: DevinSessionSummary,
  dbPath: string,
  dbBytes: number,
): DiscoveredSession {
  const isStoredSizeKnown = devinSessionSummary.sizeBytes > 0;
  const sizeBytes = isStoredSizeKnown ? devinSessionSummary.sizeBytes : dbBytes;

  return {
    id: devinSessionSummary.id,
    provider: DEVIN_PROVIDER_ID,
    title: devinSessionSummary.title,
    slug: slugifyTitle(devinSessionSummary.title),
    originalPath: dbPath,
    createdAt: readDateFromDevinTimestamp(devinSessionSummary.createdAt),
    modifiedAt: readDateFromDevinTimestamp(devinSessionSummary.modifiedAt),
    sizeBytes,
    status: LIVE_SESSION_STATUS,
  };
}

function readSessionFromDatabaseSnapshot(
  dbPath: string,
  dbBytes: number,
  modifiedAt: Date,
): DiscoveredSession {
  return {
    id: 'sessions-db',
    provider: DEVIN_PROVIDER_ID,
    title: 'Devin sessions database',
    slug: 'devin-sessions-database',
    originalPath: dbPath,
    modifiedAt,
    sizeBytes: dbBytes,
    status: LIVE_SESSION_STATUS,
  };
}

function readDateFromDevinTimestamp(timestamp: number): Date {
  const largestUnixSecondsTimestamp = 9_999_999_999;

  if (timestamp > largestUnixSecondsTimestamp) {
    return new Date(timestamp);
  }

  const millisecondsPerSecond = 1000;
  return new Date(timestamp * millisecondsPerSecond);
}

export function parseOptionalProvider(provider: string | undefined): ProviderId | undefined {
  const isProviderMissing = provider == null;
  if (isProviderMissing) {
    return undefined;
  }

  return readProviderId(provider) ?? undefined;
}

export interface ProviderSelection {
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly isProviderUnknown: boolean;
}

export function selectProviders(
  provider: string | undefined,
  providersOverride?: ReadonlyArray<ProviderAdapter>,
): ProviderSelection {
  if (providersOverride != null) {
    return { providers: providersOverride, isProviderUnknown: false };
  }

  const isProviderMissing = provider == null;

  if (isProviderMissing) {
    return { providers: allProviders, isProviderUnknown: false };
  }

  const providerId = parseOptionalProvider(provider);

  const isProviderUnknown = providerId == null;

  if (isProviderUnknown) {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    return { providers: [], isProviderUnknown };
  }

  function isAdapterForId(adapter: ProviderAdapter): boolean {
    return adapter.id == providerId;
  }

  const providersForId = allProviders.filter(isAdapterForId);

  return { providers: providersForId, isProviderUnknown };
}

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

export function listDefaultSessionStores(
  providers: ReadonlyArray<ProviderAdapter>,
  home: string,
): SessionStore[] {
  const stores: SessionStore[] = [];

  for (const provider of providers) {
    for (const path of provider.defaultRoots(home)) {
      stores.push({ provider: provider.id, path });
    }
  }

  return stores;
}
