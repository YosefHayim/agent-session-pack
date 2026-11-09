import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const TITLE_SEARCH_LIMIT_BYTES = 1024 * 1024;
const TITLE_READ_HIGH_WATER_MARK_BYTES = 64 * 1024;

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
 * Collects JSONL files below a provider store, skipping the excluded directory names.
 */
export const collectJsonlSessions = async (
  root: string,
  options: CollectJsonlOptions,
): Promise<ReadonlyArray<JsonlSessionFile>> => {
  const entries = await readdir(root, { withFileTypes: true });
  const files: JsonlSessionFile[] = [];

  for (const entry of entries) {
    const isExcludedName = options.excludePathParts.includes(entry.name);
    if (isExcludedName) {
      continue;
    }

    const entryPath = join(root, entry.name);

    const isDirectoryEntry = entry.isDirectory();
    if (isDirectoryEntry) {
      files.push(...(await collectJsonlSessions(entryPath, options)));
      continue;
    }

    const isNotFile = !entry.isFile();
    if (isNotFile) {
      continue;
    }

    const isNotNameEndsWithJsonl = !entry.name.endsWith('.jsonl');
    if (isNotNameEndsWithJsonl) {
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

/**
 * Measures total file bytes and newest mtime for a session directory tree.
 */
export const measureDirectorySession = async (path: string): Promise<DirectorySessionEntry> => {
  const rootStat = await stat(path);
  let sizeBytes = 0;
  let modifiedAt = rootStat.mtime;

  const walk = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(directory, entry.name);

      const isDirectoryEntry = entry.isDirectory();
      if (isDirectoryEntry) {
        await walk(entryPath);
        continue;
      }

      const isNotFile = !entry.isFile();
      if (isNotFile) {
        continue;
      }

      const fileStat = await stat(entryPath);
      sizeBytes += fileStat.size;

      const isFileNewer = fileStat.mtime.getTime() > modifiedAt.getTime();
      if (isFileNewer) {
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

/**
 * Converts text into a stable session slug.
 */
export const slugifyTitle = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  const isSlugEmpty = slug.length === 0;
  if (isSlugEmpty) {
    return 'untitled-session';
  }

  return slug;
};

/**
 * Extracts a provider session id from a file path: the UUID when present, else the basename.
 */
export const sessionIdFromPath = (path: string): string => {
  const fileName = basename(path, extname(path));
  const idMatch = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const isIdFound = idMatch != null;
  if (isIdFound) {
    return idMatch[0];
  }

  return fileName;
};

/**
 * Reads the first meaningful user text from a JSONL session file, falling back to the basename.
 */
export const readSessionTitle = (path: string): Promise<string> => readSessionTitleFromFile(path);

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

    const isScanTitleNotEmpty = scan.title.length > 0;
    if (isScanTitleNotEmpty) {
      stream.destroy();
      return scan.title;
    }

    carry = scan.rest;

    const isSearchLimitReached = bytesRead >= TITLE_SEARCH_LIMIT_BYTES;
    if (isSearchLimitReached) {
      stream.destroy();
      return basename(path, extname(path));
    }
  }

  const finalTitle = titleFromJsonLine(carry);

  const isTitleNotEmpty = finalTitle.length > 0;
  if (isTitleNotEmpty) {
    return finalTitle;
  }

  return basename(path, extname(path));
};

const streamChunkToString = (chunk: string | Buffer): string => {
  const isChunkTypeString = typeof chunk === 'string';
  if (isChunkTypeString) {
    return chunk;
  }

  return chunk.toString('utf8');
};

const titleFromDelimitedLines = (
  content: string,
): { readonly title: string; readonly rest: string } => {
  const lines = content.split(/\r?\n/);
  const rest = lines.pop();

  const isRestMissing = rest == null;
  if (isRestMissing) {
    return {
      title: '',
      rest: '',
    };
  }

  for (const line of lines) {
    const title = titleFromJsonLine(line);

    const isTitleNotEmpty = title.length > 0;
    if (isTitleNotEmpty) {
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

    const isEventTypeNotUser = event.type !== 'user';
    if (isEventTypeNotUser) {
      return '';
    }

    const isEventTypeString = typeof event.text === 'string';
    if (isEventTypeString) {
      return event.text;
    }

    const isEventMessageTypeNotObjectOrMissing =
      typeof event.message !== 'object' || event.message === null;
    if (isEventMessageTypeNotObjectOrMissing) {
      return '';
    }

    const message = event.message as { readonly content?: unknown };

    const isMessageTypeString = typeof message.content === 'string';
    if (isMessageTypeString) {
      return message.content;
    }

    return '';
  } catch {
    return '';
  }
};
