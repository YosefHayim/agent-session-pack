import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { throwWrappedError } from '@/rethrow-as-error.js';
import type { ProviderId, SessionSourceKind } from '@/session-model.js';

/**
 * Magic marker written into packed-session stubs so GUI list/open can find them.
 */
export const ARCHIVED_STUB_KIND = 'agent-session-pack-archived-stub' as const;

const STUB_MARKER_FILE = '.agent-session-pack-archived.json';

type ArchivedStub = {
  readonly agentSessionPack: typeof ARCHIVED_STUB_KIND;
  readonly version: 1;
  readonly sessionId: string;
  readonly provider: string;
  readonly sourceKind: SessionSourceKind;
};

/**
 * Inputs for writing an archived-session stub.
 */
export type WriteArchivedStubRequest = {
  readonly originalPath: string;
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly sourceKind: SessionSourceKind;
};

/**
 * Writes a tiny listable stub at the original session path after pack removes the full session.
 */
export const writeArchivedStub = async (request: WriteArchivedStubRequest): Promise<void> => {
  const stub: ArchivedStub = {
    agentSessionPack: ARCHIVED_STUB_KIND,
    version: 1,
    sessionId: request.sessionId,
    provider: request.provider,
    sourceKind: request.sourceKind,
  };
  const body = `${JSON.stringify(stub, null, 2)}\n`;

  const isDirectorySource = request.sourceKind === 'directory';

  if (isDirectorySource) {
    await mkdir(request.originalPath, { recursive: true }).catch(throwWrappedError);
    await writeFile(join(request.originalPath, STUB_MARKER_FILE), body, 'utf8').catch(
      throwWrappedError,
    );
    return;
  }

  await mkdir(dirname(request.originalPath), { recursive: true }).catch(throwWrappedError);
  await writeFile(request.originalPath, body, 'utf8').catch(throwWrappedError);
};

/**
 * Returns true when the path is an archived stub (not a full live session).
 */
export const isArchivedStubPath = async (
  path: string,
  sourceKind: SessionSourceKind,
): Promise<boolean> => {
  try {
    const isDirectorySource = sourceKind === 'directory';

    if (isDirectorySource) {
      const markerPath = join(path, STUB_MARKER_FILE);
      const content = await readFile(markerPath, 'utf8');
      return isStubJson(content);
    }

    const content = await readFile(path, 'utf8');
    return isStubJson(content);
  } catch {
    return false;
  }
};

/**
 * Returns true when a directory stub has been touched beyond the marker (provider open signal).
 */
export const isDirectoryStubOpened = async (path: string): Promise<boolean> => {
  try {
    const entries = await readdir(path);
    return entries.some((entry) => entry !== STUB_MARKER_FILE);
  } catch {
    return false;
  }
};

const isStubJson = (content: string): boolean => {
  try {
    const parsed = JSON.parse(content) as { agentSessionPack?: string };
    return parsed.agentSessionPack === ARCHIVED_STUB_KIND;
  } catch {
    return false;
  }
};
