import { Buffer } from 'node:buffer';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const titleSearchLimitBytes = 1024 * 1024;
const titleReadHighWaterMarkBytes = 64 * 1024;

export type JsonlSessionFile = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
};

export type DirectorySessionFile = {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: Date;
};

export type CollectJsonlSettings = {
  readonly excludePathParts: ReadonlyArray<string>;
};

export const collectJsonlSessions = async (
  root: string,
  settings: CollectJsonlSettings,
): Promise<ReadonlyArray<JsonlSessionFile>> => {
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
};

export const measureDirectorySession = async (path: string): Promise<DirectorySessionFile> => {
  const rootStat = await stat(path);
  let sizeBytes = 0;
  let modifiedAt = rootStat.mtime;

  const walk = async (directory: string): Promise<void> => {
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
  };

  await walk(path);

  return {
    path,
    sizeBytes,
    modifiedAt,
  };
};

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

export const readSessionIdFromPath = (path: string): string => {
  const fileName = basename(path, extname(path));
  const idHit = fileName.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

  const isIdFound = idHit != null;
  if (isIdFound) {
    return idHit[0];
  }

  return fileName;
};

export const readSessionTitle = (path: string): Promise<string> => readSessionTitleFromFile(path);

const readSessionTitleFromFile = async (path: string): Promise<string> => {
  let carry = '';
  let bytesRead = 0;
  const stream = createReadStream(path, {
    encoding: 'utf8',
    highWaterMark: titleReadHighWaterMarkBytes,
  });

  for await (const chunk of stream) {
    const chunkString = streamChunkToString(chunk);
    bytesRead += Buffer.byteLength(chunkString, 'utf8');

    const scan = readTitleFromDelimitedLines(`${carry}${chunkString}`);

    const hasScanTitle = scan.title.length > 0;
    if (hasScanTitle) {
      stream.destroy();
      return scan.title;
    }

    carry = scan.rest;

    const isSearchLimitReached = bytesRead >= titleSearchLimitBytes;
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
};

const streamChunkToString = (chunk: string | Buffer): string => {
  const isChunkTypeString = typeof chunk === 'string';
  if (isChunkTypeString) {
    return chunk;
  }

  return chunk.toString('utf8');
};

const readTitleFromDelimitedLines = (
  fileString: string,
): { readonly title: string; readonly rest: string } => {
  const lines = fileString.split(/\r?\n/);
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
};

const readTitleFromJsonlLine = (line: string): string => {
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
