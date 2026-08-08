import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Effect, Schema } from 'effect';

const TITLE_SEARCH_LIMIT_BYTES = 1024 * 1024;
const TITLE_READ_HIGH_WATER_MARK_BYTES = 64 * 1024;

/**
 * Schema enumerating the supported provider identifiers.
 */
export const ProviderIdSchema = Schema.Literal(
  'codex',
  'claude',
  'kiro',
  'cursor',
  'devin',
  'grok',
  'kimi',
  'opencode',
  'gemini',
);
/**
 * Supported provider identifier value.
 */
export type ProviderId = typeof ProviderIdSchema.Type;

/**
 * Schema enumerating whether a session is stored as one file or a directory tree.
 */
export const SessionSourceKindSchema = Schema.Literal('file', 'directory');
/**
 * Session source storage kind value.
 */
export type SessionSourceKind = typeof SessionSourceKindSchema.Type;

/**
 * Schema enumerating how a provider store may be treated.
 */
export const ProviderModeSchema = Schema.Literal('archive', 'backup-only');
/**
 * Provider handling mode value.
 */
export type ProviderMode = typeof ProviderModeSchema.Type;

/**
 * Schema enumerating lifecycle states a session can occupy.
 */
export const SessionStatusSchema = Schema.Literal(
  'live',
  'cold',
  'archived',
  'restored',
  'pinned',
  'quarantined',
);
/**
 * Session lifecycle status value.
 */
export type SessionStatus = typeof SessionStatusSchema.Type;

/**
 * Schema describing a session discovered in a provider store.
 */
export const DiscoveredSessionSchema = Schema.Struct({
  id: Schema.String,
  provider: ProviderIdSchema,
  title: Schema.String,
  slug: Schema.String,
  originalPath: Schema.String,
  modifiedAt: Schema.DateFromSelf,
  sizeBytes: Schema.Number,
  sourceKind: Schema.optional(SessionSourceKindSchema),
  createdAt: Schema.optional(Schema.DateFromSelf),
  status: Schema.optional(SessionStatusSchema),
  archivePath: Schema.optional(Schema.String),
  savedPercent: Schema.optional(Schema.Number),
});
/**
 * Decoded discovered session record.
 */
export type DiscoveredSession = typeof DiscoveredSessionSchema.Type;

/**
 * Provider store location targeted by a scan.
 */
export type SessionStore = {
  readonly provider: ProviderId;
  readonly path: string;
};

/**
 * File metadata for a discovered JSONL session file.
 */
export type JsonlSessionFile = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
};

/**
 * Directory metadata for a multi-file provider session.
 */
export type DirectorySessionEntry = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
};

/**
 * Options controlling which directories are skipped while collecting JSONL files.
 */
export type CollectJsonlOptions = {
  readonly excludePathParts: ReadonlyArray<string>;
};

/**
 * Read-only provider adapter used to discover sessions in a store.
 */
export type ProviderAdapter = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (
    store: SessionStore,
  ) => Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError>;
};

/**
 * Typed error raised when provider discovery fails.
 */
export class ProviderDiscoveryError extends Schema.TaggedError<ProviderDiscoveryError>()(
  'ProviderDiscoveryError',
  {
    provider: ProviderIdSchema,
    path: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Stores and providers to inspect during a scan.
 */
export type ScanRequest = {
  readonly stores: ReadonlyArray<SessionStore>;
  readonly providers: ReadonlyArray<ProviderAdapter>;
};

/**
 * Aggregated sessions discovered across all scanned stores.
 */
export type ScanReport = {
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

/**
 * Collects JSONL files below a provider store.
 *
 * @param root - Store root to scan.
 * @param options - Path parts that should be skipped during recursion.
 * @returns Effect containing discovered JSONL file metadata.
 * @example
 * ```ts
 * import { collectJsonlSessions } from './sessionStore.js';
 *
 * const files = await Effect.runPromise(
 *   collectJsonlSessions('/root', { excludePathParts: ['node_modules'] }),
 * );
 * ```
 */
export const collectJsonlSessions = (
  root: string,
  options: CollectJsonlOptions,
): Effect.Effect<ReadonlyArray<JsonlSessionFile>, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: () => collectJsonlSessionFiles(root, options),
    catch: (cause) =>
      new ProviderDiscoveryError({
        provider: 'codex',
        path: root,
        message: String(cause),
      }),
  });

/**
 * Measures total file bytes and newest mtime for a session directory tree.
 *
 * @param path - Session directory path.
 * @returns Effect containing directory size and modified time.
 * @example
 * ```ts
 * import { measureDirectorySession } from './sessionStore.js';
 *
 * const entry = await Effect.runPromise(measureDirectorySession('/sessions/abc'));
 * ```
 */
export const measureDirectorySession = (
  path: string,
): Effect.Effect<DirectorySessionEntry, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: () => measureDirectorySessionEntry(path),
    catch: (cause) =>
      new ProviderDiscoveryError({
        provider: 'codex',
        path,
        message: String(cause),
      }),
  });

/**
 * Converts text into a stable session slug.
 *
 * @param title - Human title extracted from provider data.
 * @returns Lowercase slug suitable for selectors.
 * @example
 * ```ts
 * import { slugifyTitle } from './sessionStore.js';
 *
 * const slug = slugifyTitle('Fix login bug');
 * ```
 */
export const slugifyTitle = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length === 0) {
    return 'untitled-session';
  }

  return slug;
};

/**
 * Extracts a provider session id from a file path.
 *
 * @param path - Provider session file path.
 * @returns UUID-like id when available, otherwise the basename without extension.
 * @example
 * ```ts
 * import { sessionIdFromPath } from './sessionStore.js';
 *
 * const id = sessionIdFromPath('/sessions/2024-01-01-abc.jsonl');
 * ```
 */
export const sessionIdFromPath = (path: string): string => {
  const fileName = basename(path, extname(path));
  const idMatch = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  if (idMatch !== null) {
    return idMatch[0];
  }

  return fileName;
};

/**
 * Reads the first meaningful user text from a JSONL session file.
 *
 * @param path - Provider JSONL session path.
 * @returns Effect containing the title fallback text.
 * @example
 * ```ts
 * import { readSessionTitle } from './sessionStore.js';
 *
 * const title = await Effect.runPromise(readSessionTitle('/sessions/abc.jsonl'));
 * ```
 */
export const readSessionTitle = (path: string): Effect.Effect<string, ProviderDiscoveryError> =>
  Effect.tryPromise({
    try: () => readSessionTitleFromFile(path),
    catch: (cause) =>
      new ProviderDiscoveryError({
        provider: 'codex',
        path,
        message: String(cause),
      }),
  });

/**
 * Scans stores by delegating discovery to read-only providers.
 *
 * @param request - Providers and stores to scan.
 * @returns Scan report containing all discovered sessions.
 * @example
 * ```ts
 * import { scanStores } from './sessionStore.js';
 *
 * const report = await Effect.runPromise(scanStores({ stores, providers }));
 * ```
 */
export const scanStores = (
  request: ScanRequest,
): Effect.Effect<ScanReport, ProviderDiscoveryError> =>
  Effect.gen(function* () {
    const discovered = yield* Effect.all(
      request.stores.map((store) => {
        const provider = request.providers.find((adapter) => adapter.id === store.provider);

        if (provider === undefined) {
          return Effect.succeed<ReadonlyArray<DiscoveredSession>>([]);
        }

        return provider.discover(store);
      }),
    );

    return {
      sessions: discovered.flat(),
    };
  });

const collectJsonlSessionFiles = async (
  root: string,
  options: CollectJsonlOptions,
): Promise<ReadonlyArray<JsonlSessionFile>> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: JsonlSessionFile[] = [];

  for (const entry of entries) {
    if (options.excludePathParts.includes(entry.name)) {
      continue;
    }

    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectJsonlSessionFiles(entryPath, options)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!entry.name.endsWith('.jsonl')) {
      continue;
    }

    const fileStat = await stat(entryPath);
    files.push({
      path: entryPath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime,
    });
  }

  return files;
};

const measureDirectorySessionEntry = async (path: string): Promise<DirectorySessionEntry> => {
  const rootStat = await stat(path);
  let sizeBytes = 0;
  let modifiedAt = rootStat.mtime;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const fileStat = await stat(entryPath);
      sizeBytes += fileStat.size;

      if (fileStat.mtime.getTime() > modifiedAt.getTime()) {
        modifiedAt = fileStat.mtime;
      }
    }
  };

  await walk(path);

  return {
    path,
    sizeBytes,
    modifiedAt,
  };
};

const readSessionTitleFromFile = async (path: string): Promise<string> => {
  let carry = '';
  let bytesRead = 0;
  const stream = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: TITLE_READ_HIGH_WATER_MARK_BYTES,
  });

  for await (const chunk of stream) {
    const text = streamChunkToString(chunk);
    bytesRead += Buffer.byteLength(text, 'utf8');

    const scan = titleFromDelimitedLines(`${carry}${text}`);

    if (scan.title.length > 0) {
      stream.destroy();
      return scan.title;
    }

    carry = scan.rest;

    if (bytesRead >= TITLE_SEARCH_LIMIT_BYTES) {
      stream.destroy();
      return basename(path, extname(path));
    }
  }

  const finalTitle = titleFromJsonLine(carry);

  if (finalTitle.length > 0) {
    return finalTitle;
  }

  return basename(path, extname(path));
};

const streamChunkToString = (chunk: string | Buffer): string => {
  if (typeof chunk === 'string') {
    return chunk;
  }

  return chunk.toString('utf8');
};

const titleFromDelimitedLines = (
  content: string,
): { readonly title: string; readonly rest: string } => {
  const lines = content.split(/\r?\n/);
  const rest = lines.pop();

  if (rest === undefined) {
    return {
      title: '',
      rest: '',
    };
  }

  for (const line of lines) {
    const title = titleFromJsonLine(line);

    if (title.length > 0) {
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
};

const titleFromJsonLine = (line: string): string => {
  try {
    const event = JSON.parse(line) as {
      readonly type?: unknown;
      readonly text?: unknown;
      readonly message?: unknown;
    };

    if (event.type !== 'user') {
      return '';
    }

    if (typeof event.text === 'string') {
      return event.text;
    }

    if (typeof event.message !== 'object' || event.message === null) {
      return '';
    }

    const message = event.message as { readonly content?: unknown };

    if (typeof message.content === 'string') {
      return message.content;
    }

    return '';
  } catch {
    return '';
  }
};
