import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ProviderId, SessionOriginKind } from '@/session-model.js';

export const ARCHIVED_STUB_KIND = 'agent-session-pack-archived-stub' as const;

const STUB_MARKER_FILE = '.agent-session-pack-archived.json';

const UTF8_ENCODING = 'utf8';

const JSON_INDENT_SPACES = 2;

function isNotStubMarkerFile(name: string): boolean {
  return name !== STUB_MARKER_FILE;
}

interface ArchivedStub {
  readonly agentSessionPack: typeof ARCHIVED_STUB_KIND;
  readonly version: 1;
  readonly sessionId: string;
  readonly provider: string;
  readonly sourceKind: SessionOriginKind;
}

export interface WriteArchivedStubRequest {
  readonly originalPath: string;
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly sourceKind: SessionOriginKind;
}

export async function writeArchivedStub(request: WriteArchivedStubRequest): Promise<void> {
  const stub: ArchivedStub = {
    agentSessionPack: ARCHIVED_STUB_KIND,
    version: 1,
    sessionId: request.sessionId,
    provider: request.provider,
    sourceKind: request.sourceKind,
  };
  const stubString = `${JSON.stringify(stub, null, JSON_INDENT_SPACES)}\n`;

  const isDirectoryOrigin = request.sourceKind === 'directory';

  try {
    if (isDirectoryOrigin) {
      await mkdir(request.originalPath, { recursive: true });
      await writeFile(join(request.originalPath, STUB_MARKER_FILE), stubString, UTF8_ENCODING);
      return;
    }

    await mkdir(dirname(request.originalPath), { recursive: true });
    await writeFile(request.originalPath, stubString, UTF8_ENCODING);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function isArchivedStubPath(
  path: string,
  originKind: SessionOriginKind,
): Promise<boolean> {
  try {
    const isDirectoryOrigin = originKind === 'directory';

    if (isDirectoryOrigin) {
      const markerPath = join(path, STUB_MARKER_FILE);
      const markerString = await readFile(markerPath, UTF8_ENCODING);

      return isStubDocument(markerString);
    }

    const fileString = await readFile(path, UTF8_ENCODING);
    return isStubDocument(fileString);
  } catch {
    return false;
  }
}

export async function isDirectoryStubOpened(path: string): Promise<boolean> {
  try {
    const names = await readdir(path);
    return names.some(isNotStubMarkerFile);
  } catch {
    return false;
  }
}

function isStubDocument(stubString: string): boolean {
  try {
    const parsed: { agentSessionPack?: string } = JSON.parse(stubString);

    return parsed.agentSessionPack === ARCHIVED_STUB_KIND;
  } catch {
    return false;
  }
}
