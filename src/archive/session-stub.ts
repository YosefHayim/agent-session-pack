import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { ProviderId, SessionOriginKind } from '@/session-model.js';

export const ARCHIVED_STUB_KIND = 'agent-session-pack-archived-stub' as const;

const STUB_MARKER_FILE = '.agent-session-pack-archived.json';

type ArchivedStub = {
  readonly agentSessionPack: typeof ARCHIVED_STUB_KIND;
  readonly version: 1;
  readonly sessionId: string;
  readonly provider: string;
  readonly sourceKind: SessionOriginKind;
};

export type WriteArchivedStubRequest = {
  readonly originalPath: string;
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly sourceKind: SessionOriginKind;
};

export const writeArchivedStub = async (request: WriteArchivedStubRequest): Promise<void> => {
  const stub: ArchivedStub = {
    agentSessionPack: ARCHIVED_STUB_KIND,
    version: 1,
    sessionId: request.sessionId,
    provider: request.provider,
    sourceKind: request.sourceKind,
  };
  const stubString = `${JSON.stringify(stub, null, 2)}\n`;

  const isDirectoryOrigin = request.sourceKind === 'directory';

  if (isDirectoryOrigin) {
    await mkdir(request.originalPath, { recursive: true }).catch(throwWrappedError);
    await writeFile(join(request.originalPath, STUB_MARKER_FILE), stubString, 'utf8').catch(
      throwWrappedError,
    );
    return;
  }

  await mkdir(dirname(request.originalPath), { recursive: true }).catch(throwWrappedError);
  await writeFile(request.originalPath, stubString, 'utf8').catch(throwWrappedError);
};

export const isArchivedStubPath = async (
  path: string,
  originKind: SessionOriginKind,
): Promise<boolean> => {
  try {
    const isDirectoryOrigin = originKind === 'directory';

    if (isDirectoryOrigin) {
      const markerPath = join(path, STUB_MARKER_FILE);
      const markerString = await readFile(markerPath, 'utf8');
      return isStubDocument(markerString);
    }

    const fileString = await readFile(path, 'utf8');
    return isStubDocument(fileString);
  } catch {
    return false;
  }
};

export const isDirectoryStubOpened = async (path: string): Promise<boolean> => {
  try {
    const names = await readdir(path);
    return names.some((name) => name !== STUB_MARKER_FILE);
  } catch {
    return false;
  }
};

const isStubDocument = (stubString: string): boolean => {
  try {
    const parsed = JSON.parse(stubString) as { agentSessionPack?: string };
    return parsed.agentSessionPack === ARCHIVED_STUB_KIND;
  } catch {
    return false;
  }
};
