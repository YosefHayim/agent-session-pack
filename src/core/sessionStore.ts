import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { Effect, Schema } from 'effect';

export const ProviderIdSchema = Schema.Literal('codex', 'claude', 'kiro', 'cursor', 'devin');
export type ProviderId = typeof ProviderIdSchema.Type;

export const ProviderModeSchema = Schema.Literal('archive', 'backup-only');
export type ProviderMode = typeof ProviderModeSchema.Type;

export const SessionStatusSchema = Schema.Literal(
  'live',
  'cold',
  'archived',
  'restored',
  'pinned',
  'quarantined',
);
export type SessionStatus = typeof SessionStatusSchema.Type;

export const DiscoveredSessionSchema = Schema.Struct({
  id: Schema.String,
  provider: ProviderIdSchema,
  title: Schema.String,
  slug: Schema.String,
  originalPath: Schema.String,
  modifiedAt: Schema.DateFromSelf,
  sizeBytes: Schema.Number,
  createdAt: Schema.optional(Schema.DateFromSelf),
  status: Schema.optional(SessionStatusSchema),
  archivePath: Schema.optional(Schema.String),
  savedPercent: Schema.optional(Schema.Number),
});
export type DiscoveredSession = typeof DiscoveredSessionSchema.Type;

export type SessionStore = {
  readonly provider: ProviderId;
  readonly path: string;
};

export type JsonlSessionFile = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
};

export type CollectJsonlOptions = {
  readonly excludePathParts: ReadonlyArray<string>;
};

export type ProviderAdapter = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (
    store: SessionStore,
  ) => Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError>;
};

export class ProviderDiscoveryError extends Schema.TaggedError<ProviderDiscoveryError>()(
  'ProviderDiscoveryError',
  {
    provider: ProviderIdSchema,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export type ScanRequest = {
  readonly stores: ReadonlyArray<SessionStore>;
  readonly providers: ReadonlyArray<ProviderAdapter>;
};

export type ScanReport = {
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

const titleSearchLimitBytes = 1024 * 1024;
const titleReadHighWaterMarkBytes = 64 * 1024;

/**
 * Collects JSONL files below a provider store.
 *
 * @param root - Store root to scan.
 * @param options - Path parts that should be skipped during recursion.
 * @returns Effect containing discovered JSONL file metadata.
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
 * Converts text into a stable session slug.
 *
 * @param title - Human title extracted from provider data.
 * @returns Lowercase slug suitable for selectors.
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

const readSessionTitleFromFile = async (path: string): Promise<string> => {
  let carry = '';
  let bytesRead = 0;
  const stream = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: titleReadHighWaterMarkBytes,
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

    if (bytesRead >= titleSearchLimitBytes) {
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
