import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const BYTES_PER_KIBIBYTE = 1024;
const TITLE_SEARCH_LIMIT_BYTES = BYTES_PER_KIBIBYTE * BYTES_PER_KIBIBYTE;
const TITLE_READ_HIGH_WATER_MARK_BYTES = 64 * BYTES_PER_KIBIBYTE;

// Catches a UUID such as 123e4567-e89b-12d3-a456-426614174000 inside a name.
export const SESSION_UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export interface JsonlSessionFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
}

export interface DirectorySessionFile {
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
): Promise<ReadonlyArray<JsonlSessionFile>> {
  const dirents = await readdir(root, { withFileTypes: true });
  const files: JsonlSessionFile[] = [];

  for (const dirent of dirents) {
    const isExcludedName = settings.excludePathParts.includes(dirent.name);
    if (isExcludedName) {
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

    const isNotJsonlName = !dirent.name.endsWith('.jsonl');
    if (isNotJsonlName) {
      continue;
    }

    const fileStat = await stat(childPath);
    files.push({
      path: childPath,
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime,
    });
  }

  return files;
}

export async function measureDirectorySession(path: string): Promise<DirectorySessionFile> {
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

      const isFileNewer = fileStat.mtime.getTime() > modifiedAt.getTime();
      if (isFileNewer) {
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
}

export function slugifyTitle(title: string): string {
  // Catches each run of characters that are not letters or digits.
  const nonAlphanumericRuns = /[^a-z0-9]+/g;
  // Catches dashes at the start or the end of the slug.
  const edgeDashes = /^-+|-+$/g;
  const slug = title.toLowerCase().replace(nonAlphanumericRuns, '-').replace(edgeDashes, '');

  const isSlugEmpty = slug.length === 0;
  if (isSlugEmpty) {
    return 'untitled-session';
  }

  return slug;
}

export function readSessionIdFromPath(path: string): string {
  const fileName = basename(path, extname(path));
  const idHit = fileName.match(SESSION_UUID_PATTERN);

  const isIdFound = idHit != null;
  if (isIdFound) {
    return idHit[0];
  }

  return fileName;
}

export function readSessionTitle(path: string): Promise<string> {
  return readSessionTitleFromFile(path);
}

async function readSessionTitleFromFile(path: string): Promise<string> {
  let carry = '';
  let bytesRead = 0;
  const stream = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: TITLE_READ_HIGH_WATER_MARK_BYTES,
  });

  for await (const chunk of stream) {
    const chunkString = streamChunkToString(chunk);
    bytesRead += Buffer.byteLength(chunkString, 'utf8');

    const titleScan = readTitleFromDelimitedLines(`${carry}${chunkString}`);

    const hasTitleInScan = titleScan.title.length > 0;
    if (hasTitleInScan) {
      stream.destroy();
      return titleScan.title;
    }

    carry = titleScan.rest;

    const isSearchLimitReached = bytesRead >= TITLE_SEARCH_LIMIT_BYTES;
    if (isSearchLimitReached) {
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
}

function streamChunkToString(chunk: string | Buffer): string {
  const isChunkTypeString = typeof chunk === 'string';
  if (isChunkTypeString) {
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

  const isRestMissing = rest == null;
  if (isRestMissing) {
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

    const isEventNotObject = !isJsonObject(event);
    if (isEventNotObject) {
      return '';
    }

    const isEventTypeNotUser = event.type !== 'user';
    if (isEventTypeNotUser) {
      return '';
    }

    const eventText = event.text;
    const isEventTextString = typeof eventText === 'string';
    if (isEventTextString) {
      return eventText;
    }

    const eventMessage = event.message;
    const isEventMessageNotObject = !isJsonObject(eventMessage);
    if (isEventMessageNotObject) {
      return '';
    }

    const messageContent = eventMessage.content;
    const isMessageContentString = typeof messageContent === 'string';
    if (isMessageContentString) {
      return messageContent;
    }

    return '';
  } catch {
    return '';
  }
}

export function isJsonObject(candidate: unknown): candidate is Readonly<Record<string, unknown>> {
  const isObjectType = typeof candidate === 'object';
  const isNotNull = candidate !== null;

  return isObjectType && isNotNull;
}
