import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, type Dirent, type Stats } from 'node:fs';
import {
  copyFile,
  cp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { promisify } from 'node:util';
import {
  type DiscoveredSession,
  type ProviderAdapter,
  type ProviderId,
  readProviderId,
  readSessionOriginKind,
  type SessionOriginKind,
} from './providers.js';

export interface CommandExit {
  // 0 ok, 1 failed, 2 bad usage. Watch passes a child process exit code through.
  readonly exitCode: number;
}

export const HOME_NOT_SET_CANCEL_MESSAGE =
  'HOME is not set. Agent Session Pack needs HOME to resolve vault and config paths (default ~/.agent-session-pack). Set HOME in your shell. No files changed.';

export function requireHome(homeOverride?: string): string | null {
  const home = homeOverride ?? readHomeFolder();

  if (home == null) {
    process.stderr.write(
      [
        'HOME is not set.',
        '',
        'Agent Session Pack needs HOME to resolve vault and config paths under your home directory',
        '(default: ~/.agent-session-pack). Export HOME in your shell environment.',
        '',
      ].join('\n'),
    );
    return null;
  }

  return home;
}

export function readHomeFolder(): string | undefined {
  return process.env.HOME;
}

const BYTES_PER_UNIT = 1024;
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function describeBytes(bytes: number): string {
  if (bytes < BYTES_PER_UNIT) {
    return `${bytes} B`;
  }

  let remainingBytes = bytes;
  let unitIndex = 0;

  while (remainingBytes >= BYTES_PER_UNIT && unitIndex < BYTE_UNITS.length - 1) {
    remainingBytes = remainingBytes / BYTES_PER_UNIT;
    unitIndex += 1;
  }

  const threeDigitsMinimum = 100;

  if (remainingBytes >= threeDigitsMinimum) {
    return `${remainingBytes.toFixed(0)} ${BYTE_UNITS[unitIndex]}`;
  }

  return `${remainingBytes.toFixed(1)} ${BYTE_UNITS[unitIndex]}`;
}

export function describeOptionalBytes(bytes: number | undefined, missingLabel: string): string {
  if (bytes == null) {
    return missingLabel;
  }

  return describeBytes(bytes);
}

export function describeOptionalPercent(percent: number | undefined, missingLabel: string): string {
  if (percent == null) {
    return missingLabel;
  }

  return `${percent.toFixed(1)}%`;
}

const WHOLE_PERCENT = 100;

export function sumSessionBytes(sessions: ReadonlyArray<DiscoveredSession>): number {
  function addSessionBytes(totalBytes: number, session: DiscoveredSession): number {
    return totalBytes + session.sizeBytes;
  }

  return sessions.reduce(addSessionBytes, 0);
}

export function calculateSavedPercent(originBytes: number, archiveBytes: number): number {
  if (originBytes == 0) {
    return 0;
  }

  return Number((WHOLE_PERCENT - (archiveBytes / originBytes) * WHOLE_PERCENT).toFixed(1));
}

export function describeTouched(touched: boolean): string {
  return touched ? 'yes' : 'no';
}

export function describeStatus(status: string, reason: string | undefined): string {
  if (reason == null) {
    return status;
  }

  return `${status} (${reason})`;
}

function isMissingPathError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const hasNoErrorCode = !('code' in error);
  if (hasNoErrorCode) {
    return false;
  }

  return error.code == 'ENOENT';
}

export async function readDirectoryDirents(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw new Error(String(error), { cause: error });
  }
}

export async function measureOriginBytes(
  path: string,
  originKind?: SessionOriginKind,
): Promise<number> {
  const kind = await findOriginKind(path, originKind);

  if (kind == 'file') {
    const fileStat = await readStatPath(path);
    return fileStat.size;
  }

  return readDirectorySizeBytes(path);
}

export async function findOriginKind(
  path: string,
  originKind: SessionOriginKind | undefined,
): Promise<SessionOriginKind> {
  if (originKind != null) {
    return originKind;
  }

  try {
    const pathStat = await stat(path);
    const isPathDirectory = pathStat.isDirectory();
    return isPathDirectory ? 'directory' : 'file';
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function readDirectorySizeBytes(path: string): Promise<number> {
  let sizeBytes = 0;

  async function walk(directory: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true });

    for (const dirent of dirents) {
      const childPath = join(directory, dirent.name);

      if (dirent.isDirectory()) {
        await walk(childPath);
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      const fileStat = await stat(childPath);
      sizeBytes += fileStat.size;
    }
  }

  try {
    await walk(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }

  return sizeBytes;
}

export async function ensureParentDirectory(path: string): Promise<void> {
  await ensureDirectory(dirname(path));
}

export async function ensureDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function removePath(path: string): Promise<void> {
  try {
    await rm(path, { force: true, recursive: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function readStatPath(path: string): Promise<Stats> {
  try {
    return await stat(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

function readFileSystemErrorCode(error: unknown): string | null {
  if (typeof error != 'object') {
    return null;
  }

  if (error == null) {
    return null;
  }

  const hasNoErrorCode = !('code' in error);
  if (hasNoErrorCode) {
    return null;
  }

  return String(error.code);
}

export async function isPathPresent(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (readFileSystemErrorCode(error) == 'ENOENT') {
      return false;
    }

    throw new Error(String(error), { cause: error });
  }
}

export async function copyPath(originPath: string, destinationPath: string): Promise<void> {
  try {
    await copyFile(originPath, destinationPath);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

const SHA256_ALGORITHM = 'sha256';

const HEX_ENCODING = 'hex';

function compareDirentNames(left: Dirent, right: Dirent): number {
  return left.name.localeCompare(right.name);
}

export async function readSha256File(path: string): Promise<string> {
  try {
    return await hashFile(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export async function readSha256Path(
  path: string,
  originKind?: SessionOriginKind,
): Promise<string> {
  const kind = await findOriginKind(path, originKind);

  if (kind == 'directory') {
    return readSha256Directory(path);
  }

  return readSha256File(path);
}

export async function readSha256Directory(path: string): Promise<string> {
  try {
    return await hashDirectoryTree(path);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function hashDirectoryTree(root: string): Promise<string> {
  const files: string[] = [];

  async function walk(directory: string): Promise<void> {
    const dirents = await readdir(directory, { withFileTypes: true });
    const sorted = [...dirents].sort(compareDirentNames);

    for (const dirent of sorted) {
      const childPath = join(directory, dirent.name);

      if (dirent.isDirectory()) {
        await walk(childPath);
        continue;
      }

      if (!dirent.isFile()) {
        continue;
      }

      files.push(childPath);
    }
  }

  await walk(root);

  const treeHash = createHash(SHA256_ALGORITHM);

  for (const filePath of files) {
    const relativePath = relative(root, filePath).split(sep).join('/');
    const fileDigest = await hashFile(filePath);
    treeHash.update(relativePath);
    treeHash.update('\0');
    treeHash.update(fileDigest);
    treeHash.update('\n');
  }

  return treeHash.digest(HEX_ENCODING);
}

function hashFile(path: string): Promise<string> {
  const hash = createHash(SHA256_ALGORITHM);

  function addChunk(chunk: Buffer | string): void {
    hash.update(chunk);
  }

  function waitForDigest(fulfill: (digest: string) => void, reject: (error: Error) => void): void {
    function fulfillWithDigest(): void {
      fulfill(hash.digest(HEX_ENCODING));
    }

    createReadStream(path).on('data', addChunk).on('error', reject).on('end', fulfillWithDigest);
  }

  return new Promise(waitForDigest);
}

const ZSTD_QUIET_FLAG = '-q';
const ZSTD_FORCE_FLAG = '-f';
const ZSTD_TARGET_FILE_FLAG = '-o';

const execFileAsync = promisify(execFile);

async function runZstd(argumentList: string[]): Promise<void> {
  try {
    await execFileAsync('zstd', argumentList);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

export function createZstdCompression(): CompressionAdapter {
  async function compress(request: {
    uncompressedPath: string;
    archivePath: string;
  }): Promise<void> {
    await runZstd([
      '-9',
      '--long=27',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      request.uncompressedPath,
      ZSTD_TARGET_FILE_FLAG,
      request.archivePath,
    ]);
  }

  async function decompress(request: { archivePath: string; restoredPath: string }): Promise<void> {
    await runZstd([
      '-d',
      ZSTD_QUIET_FLAG,
      ZSTD_FORCE_FLAG,
      request.archivePath,
      ZSTD_TARGET_FILE_FLAG,
      request.restoredPath,
    ]);
  }

  return { compress, decompress };
}

export const ARCHIVED_STUB_KIND = 'agent-session-pack-archived-stub' as const;

const STUB_MARKER_FILE = '.agent-session-pack-archived.json';

const UTF8_ENCODING = 'utf8';

function isNotStubMarkerFile(name: string): boolean {
  return name != STUB_MARKER_FILE;
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
  const stubString = `${JSON.stringify(stub, null, 2)}\n`;

  const isDirectoryOrigin = request.sourceKind == 'directory';

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
    const isDirectoryOrigin = originKind == 'directory';

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

    return parsed.agentSessionPack == ARCHIVED_STUB_KIND;
  } catch {
    return false;
  }
}

export interface SessionManifest {
  readonly sessionId: string;
  readonly provider: ProviderId;
  readonly title: string;
  readonly slug: string;
  readonly originalPath: string;
  readonly archivePath: string;
  readonly sourceSha256: string;
  readonly sourceBytes: number;
  readonly archiveBytes?: number;
  readonly archivedAt: string;
  readonly sourceKind?: SessionOriginKind;
}

export async function writeSessionManifest(path: string, manifest: SessionManifest): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
  } catch (error) {
    throw new Error(`Could not write session manifest ${path}`, { cause: error });
  }
}

export async function readSessionManifest(path: string): Promise<SessionManifest> {
  try {
    const manifestString = await readFile(path, 'utf8');
    const manifestDocument: unknown = JSON.parse(manifestString);
    return readSessionManifestDocument(manifestDocument);
  } catch (error) {
    throw new Error(`Could not read session manifest ${path}`, { cause: error });
  }
}

function readSessionManifestDocument(parsed: unknown): SessionManifest {
  const manifestFields = readManifestFields(parsed);

  const manifest: SessionManifest = {
    sessionId: readRequiredManifestString(manifestFields, 'sessionId'),
    provider: readManifestProvider(manifestFields.provider),
    title: readRequiredManifestString(manifestFields, 'title'),
    slug: readRequiredManifestString(manifestFields, 'slug'),
    originalPath: readRequiredManifestString(manifestFields, 'originalPath'),
    archivePath: readRequiredManifestString(manifestFields, 'archivePath'),
    sourceSha256: readRequiredManifestString(manifestFields, 'sourceSha256'),
    sourceBytes: readRequiredManifestNumber(manifestFields, 'sourceBytes'),
    archivedAt: readRequiredManifestString(manifestFields, 'archivedAt'),
  };

  return {
    ...manifest,
    ...readOptionalManifestFields(manifestFields),
  };
}

function readManifestFields(parsed: unknown): Record<string, unknown> {
  if (typeof parsed != 'object') {
    throw new Error('Session manifest must be an object.');
  }

  if (parsed == null) {
    throw new Error('Session manifest must be an object.');
  }

  const isArray = Array.isArray(parsed);

  if (isArray) {
    throw new Error('Session manifest must be an object.');
  }

  return parsed as Record<string, unknown>;
}

function readRequiredManifestString(
  manifestFields: Record<string, unknown>,
  fieldName: string,
): string {
  const field = manifestFields[fieldName];
  const isNotString = typeof field != 'string';

  if (isNotString) {
    throw new Error(`Session manifest field ${fieldName} must be a string.`);
  }

  if (field.length == 0) {
    throw new Error(`Session manifest field ${fieldName} must be a string.`);
  }

  return field;
}

function readRequiredManifestNumber(
  manifestFields: Record<string, unknown>,
  fieldName: string,
): number {
  const field = manifestFields[fieldName];
  if (typeof field != 'number') {
    throw new Error(`Session manifest field ${fieldName} must be a number.`);
  }

  if (Number.isFinite(field) == false) {
    throw new Error(`Session manifest field ${fieldName} must be a number.`);
  }

  return field;
}

function readManifestProvider(field: unknown): ProviderId {
  const isNotString = typeof field != 'string';

  if (isNotString) {
    throw new Error('Session manifest field provider must be a provider id.');
  }

  const providerId = readProviderId(field);
  if (providerId == null) {
    throw new Error('Session manifest field provider must be a provider id.');
  }

  return providerId;
}

function readOptionalManifestFields(
  manifestFields: Record<string, unknown>,
): Pick<SessionManifest, 'archiveBytes' | 'sourceKind'> {
  return {
    archiveBytes: readOptionalManifestNumber(manifestFields, 'archiveBytes'),
    sourceKind: readOptionalOriginKind(manifestFields),
  };
}

function readOptionalManifestNumber(
  manifestFields: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  const isFieldMissing = Object.hasOwn(manifestFields, fieldName) == false;

  if (isFieldMissing) {
    return undefined;
  }

  return readRequiredManifestNumber(manifestFields, fieldName);
}

function readOptionalOriginKind(
  manifestFields: Record<string, unknown>,
): SessionOriginKind | undefined {
  const isFieldMissing = Object.hasOwn(manifestFields, 'sourceKind') == false;

  if (isFieldMissing) {
    return undefined;
  }

  const field = manifestFields.sourceKind;
  const isNotString = typeof field != 'string';

  if (isNotString) {
    throw new Error('Session manifest field sourceKind must be file or directory.');
  }

  const originKind = readSessionOriginKind(field);
  if (originKind == null) {
    throw new Error('Session manifest field sourceKind must be file or directory.');
  }

  return originKind;
}

export function listSessionManifestPaths(root: string): Promise<ReadonlyArray<string>> {
  return collectManifestPaths(root);
}

export async function listVaultSessionManifests(
  vaultPath: string,
): Promise<ReadonlyArray<SessionManifest>> {
  const manifestPaths = await listSessionManifestPaths(join(vaultPath, 'manifests'));
  const manifests: SessionManifest[] = [];

  for (const manifestPath of manifestPaths) {
    const manifest = await readSessionManifest(manifestPath);
    manifests.push(manifest);
  }

  return manifests;
}

async function collectManifestPaths(root: string): Promise<ReadonlyArray<string>> {
  const dirents = await readDirectoryDirents(root);
  const paths: string[] = [];

  for (const dirent of dirents) {
    const childPath = join(root, dirent.name);

    if (dirent.isDirectory()) {
      paths.push(...(await collectManifestPaths(childPath)));
      continue;
    }

    if (!dirent.isFile()) {
      continue;
    }

    // Manifests are the only .json files in the vault manifests folder.
    if (!dirent.name.endsWith('.json')) {
      continue;
    }

    paths.push(childPath);
  }

  return paths;
}

const VERIFY_FOLDER = 'verify';

const RESTORE_FOLDER = 'restore';

const JSONL_EXTENSION = '.jsonl';

export function createDefaultVaultPath(home: string): string {
  return join(home, '.agent-session-pack');
}

export function archivePathForSession(
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind == 'directory';
  const extension = isOriginDirectory ? 'tar.zst' : 'jsonl.zst';
  return join(
    vaultPath,
    'archives',
    session.provider,
    `${createSafePathSegment(session.id)}.${extension}`,
  );
}

export function createSessionManifestPath(vaultPath: string, session: DiscoveredSession): string {
  return join(
    vaultPath,
    'manifests',
    session.provider,
    `${createSafePathSegment(session.id)}.json`,
  );
}

export function createSessionVerificationPath(
  vaultPath: string,
  session: DiscoveredSession,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind == 'directory';
  if (isOriginDirectory) {
    return join(vaultPath, VERIFY_FOLDER, session.provider, createSafePathSegment(session.id));
  }

  return join(
    vaultPath,
    VERIFY_FOLDER,
    session.provider,
    `${createSafePathSegment(session.id)}${JSONL_EXTENSION}`,
  );
}

export function restorePathForManifest(
  vaultPath: string,
  manifest: SessionManifest,
  originKind: SessionOriginKind,
): string {
  const isOriginDirectory = originKind == 'directory';
  if (isOriginDirectory) {
    return join(
      vaultPath,
      RESTORE_FOLDER,
      manifest.provider,
      createSafePathSegment(manifest.sessionId),
    );
  }

  return join(
    vaultPath,
    RESTORE_FOLDER,
    manifest.provider,
    `${createSafePathSegment(manifest.sessionId)}${JSONL_EXTENSION}`,
  );
}

function createSafePathSegment(unsafeSegment: string): string {
  // Matches every run of characters outside a-z, 0-9, dot, underscore and dash.
  const unsafeCharacters = /[^a-z0-9._-]+/g;
  // Matches dashes at the start or end of the segment.
  const edgeDashes = /^-+|-+$/g;
  const segment = unsafeSegment
    .toLowerCase()
    .replace(unsafeCharacters, '-')
    .replace(edgeDashes, '');

  if (segment.length == 0) {
    return 'session';
  }

  return segment;
}

const TAR_BINARY = 'tar';

const TAR_EXTENSION = '.tar';

const TAR_FILE_FLAG = '-f';

const TAR_CHANGE_DIR_FLAG = '-C';

const execFileAsyncWriter = promisify(execFile);

interface CompressionRequest {
  readonly uncompressedPath: string;
  readonly archivePath: string;
}

interface DecompressionRequest {
  readonly archivePath: string;
  readonly restoredPath: string;
}

export interface CompressionAdapter {
  readonly compress: (request: CompressionRequest) => Promise<void>;
  readonly decompress: (request: DecompressionRequest) => Promise<void>;
}

export interface ArchiveWriteRequest {
  readonly sessionId: string;
  readonly sessionPath: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly apply: boolean;
  readonly compression: CompressionAdapter;
  readonly sourceKind?: SessionOriginKind;
}

export interface VerifiedArchive {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
  readonly sourceBytes: number;
  readonly archiveBytes: number;
  readonly removedOriginal: boolean;
  readonly sourceKind: SessionOriginKind;
}

export async function writeVerifiedArchive(request: ArchiveWriteRequest): Promise<VerifiedArchive> {
  const originKind = await findOriginKind(request.sessionPath, request.sourceKind);

  if (originKind == 'directory') {
    return writeVerifiedDirectoryArchive(request);
  }

  return writeVerifiedFileArchive(request);
}

export async function removeOriginalSession(path: string): Promise<void> {
  try {
    const pathStat = await stat(path);
    await rm(path, {
      force: false,
      recursive: pathStat.isDirectory(),
    });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function writeVerifiedFileArchive(request: ArchiveWriteRequest): Promise<VerifiedArchive> {
  await ensureParentDirectory(request.archivePath);
  await ensureParentDirectory(request.restoredPath);

  const originStat = await readStatPath(request.sessionPath);
  const originSha256 = await readSha256File(request.sessionPath);

  await request.compression.compress({
    uncompressedPath: request.sessionPath,
    archivePath: request.archivePath,
  });
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: request.restoredPath,
  });

  const restoredSha256 = await readSha256File(request.restoredPath);

  const isRestoreMismatched = originSha256 != restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: originSha256,
      restoredSha256,
    });
  }

  const archiveStat = await readStatPath(request.archivePath);

  const isRemovalRequested = request.apply == true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sessionPath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256: originSha256,
    restoredSha256,
    sourceBytes: originStat.size,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'file',
  };
}

async function writeVerifiedDirectoryArchive(
  request: ArchiveWriteRequest,
): Promise<VerifiedArchive> {
  await ensureParentDirectory(request.archivePath);
  await ensureDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.restoredPath);

  const originBytes = await readDirectorySizeBytes(request.sessionPath);
  const originSha256 = await readSha256Directory(request.sessionPath);
  const tarPath = `${request.archivePath}${TAR_EXTENSION}`;
  const restoredTarPath = `${request.restoredPath}${TAR_EXTENSION}`;

  await createTarArchive({
    sessionDirectoryPath: request.sessionPath,
    tarPath,
  });
  await request.compression.compress({
    uncompressedPath: tarPath,
    archivePath: request.archivePath,
  });
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: restoredTarPath,
  });
  await extractTarArchive({
    tarPath: restoredTarPath,
    destinationPath: request.restoredPath,
  });

  const restoredSha256 = await readSha256Directory(request.restoredPath);

  const isRestoreMismatched = originSha256 != restoredSha256;

  if (isRestoreMismatched) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: originSha256,
      restoredSha256,
    });
  }

  const archiveStat = await readStatPath(request.archivePath);

  await removePath(tarPath);
  await removePath(restoredTarPath);

  const isRemovalRequested = request.apply == true;

  if (isRemovalRequested) {
    await removeOriginalSession(request.sessionPath);
  }

  return {
    sessionId: request.sessionId,
    archivePath: request.archivePath,
    sourceSha256: originSha256,
    restoredSha256,
    sourceBytes: originBytes,
    archiveBytes: archiveStat.size,
    removedOriginal: request.apply,
    sourceKind: 'directory',
  };
}

export interface DirectoryRestoreRequest {
  readonly sessionId: string;
  readonly archivePath: string;
  readonly restoredPath: string;
  readonly originalPath: string;
  readonly expectedSha256: string;
  readonly compression: CompressionAdapter;
}

export async function restoreDirectoryArchive(request: DirectoryRestoreRequest): Promise<void> {
  await ensureParentDirectory(request.restoredPath);
  await removePath(request.restoredPath);
  await ensureParentDirectory(request.originalPath);
  await removePath(request.originalPath);

  const restoredTarPath = `${request.restoredPath}${TAR_EXTENSION}`;
  await request.compression.decompress({
    archivePath: request.archivePath,
    restoredPath: restoredTarPath,
  });
  await extractTarArchive({
    tarPath: restoredTarPath,
    destinationPath: request.restoredPath,
  });

  const restoredSha256 = await readSha256Directory(request.restoredPath);

  if (restoredSha256 != request.expectedSha256) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: request.expectedSha256,
      restoredSha256,
    });
  }

  await movePath(request.restoredPath, request.originalPath);
  await removePath(restoredTarPath);

  const originalSha256 = await readSha256Directory(request.originalPath);

  if (originalSha256 != request.expectedSha256) {
    throwVerificationMismatch({
      sessionId: request.sessionId,
      sourceSha256: request.expectedSha256,
      restoredSha256: originalSha256,
    });
  }
}

function throwVerificationMismatch(mismatch: {
  readonly sessionId: string;
  readonly sourceSha256: string;
  readonly restoredSha256: string;
}): never {
  throw new Error(
    `Archive verification failed for session ${mismatch.sessionId}: source ${mismatch.sourceSha256} does not match restored ${mismatch.restoredSha256}`,
  );
}

async function createTarArchive(request: {
  readonly sessionDirectoryPath: string;
  readonly tarPath: string;
}): Promise<void> {
  await ensureParentDirectory(request.tarPath);

  try {
    await execFileAsyncWriter(TAR_BINARY, [
      '-c',
      TAR_FILE_FLAG,
      request.tarPath,
      TAR_CHANGE_DIR_FLAG,
      dirname(request.sessionDirectoryPath),
      basename(request.sessionDirectoryPath),
    ]);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function extractTarArchive(request: {
  readonly tarPath: string;
  readonly destinationPath: string;
}): Promise<void> {
  const parent = dirname(request.destinationPath);
  const leaf = basename(request.destinationPath);
  const extractRoot = join(parent, `.extract-${leaf}`);

  await ensureDirectory(parent);
  await removePath(request.destinationPath);
  await removePath(extractRoot);
  await ensureDirectory(extractRoot);

  try {
    await execFileAsyncWriter(TAR_BINARY, [
      '-x',
      TAR_FILE_FLAG,
      request.tarPath,
      TAR_CHANGE_DIR_FLAG,
      extractRoot,
    ]);
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }

  const extractedDirents = await readExtractedDirents(extractRoot);
  const onlyChild = extractedDirents[0];

  const singleChildMessage = `expected one top-level entry in tar archive: ${request.tarPath}`;
  const hasWrongChildCount = extractedDirents.length != 1;
  const hasNoChild = onlyChild == null;

  if (hasWrongChildCount) {
    throw new Error(singleChildMessage);
  }

  if (hasNoChild) {
    throw new Error(singleChildMessage);
  }

  const extractedPath = join(extractRoot, onlyChild.name);
  await removePath(request.destinationPath);
  await movePath(extractedPath, request.destinationPath);
  await removePath(extractRoot);
}

async function readExtractedDirents(extractRoot: string): Promise<Dirent[]> {
  try {
    return await readdir(extractRoot, { withFileTypes: true });
  } catch (error) {
    throw new Error(String(error), { cause: error });
  }
}

async function isRenameFailing(originPath: string, destinationPath: string): Promise<boolean> {
  try {
    await rename(originPath, destinationPath);
    return false;
  } catch {
    return true;
  }
}

async function movePath(originPath: string, destinationPath: string): Promise<void> {
  await ensureParentDirectory(destinationPath);
  await removePath(destinationPath);

  // A rename fails across devices, so copy and delete the source instead.
  if (await isRenameFailing(originPath, destinationPath)) {
    try {
      await cp(originPath, destinationPath, { recursive: true });
    } catch (error) {
      throw new Error(String(error), { cause: error });
    }

    await removePath(originPath);
  }
}

function copyOriginToArchive(request: {
  uncompressedPath: string;
  archivePath: string;
}): Promise<void> {
  return copyFile(request.uncompressedPath, request.archivePath);
}

function copyArchiveToRestored(request: {
  archivePath: string;
  restoredPath: string;
}): Promise<void> {
  return copyFile(request.archivePath, request.restoredPath);
}

export const copyCompression: CompressionAdapter = {
  compress: copyOriginToArchive,
  decompress: copyArchiveToRestored,
};

export interface ArchiveProviderRequest {
  readonly id: ProviderAdapter['id'];
  readonly mode: ProviderAdapter['mode'];
  readonly rootRelative: string;
  readonly discover: ProviderAdapter['discover'];
}

export function createArchiveProvider(request: ArchiveProviderRequest): ProviderAdapter {
  function listDefaultRoots(home: string): string[] {
    return [join(home, request.rootRelative)];
  }

  return {
    id: request.id,
    label: request.id,
    mode: request.mode,
    defaultRoots: listDefaultRoots,
    discover: request.discover,
  };
}

export interface WriteColdSessionDetails {
  home: string;
  relativeDir: string;
  fileName: string;
  sessionJsonl: string;
  modifiedAt: Date;
}

export async function writeColdSession({
  home,
  relativeDir,
  fileName,
  sessionJsonl,
  modifiedAt,
}: WriteColdSessionDetails): Promise<{ readonly path: string; readonly sessionJsonl: string }> {
  const sessionDir = join(home, relativeDir);
  const sessionPath = join(sessionDir, fileName);

  try {
    await mkdir(sessionDir, { recursive: true });
    await writeFile(sessionPath, sessionJsonl);
    await utimes(sessionPath, modifiedAt, modifiedAt);
  } catch (error) {
    throw new Error(`Could not write cold session ${sessionPath}`, { cause: error });
  }

  return {
    path: sessionPath,
    sessionJsonl,
  };
}

export async function writeSessionDirectory(root: string): Promise<string> {
  const originPath = join(root, 'session-dir');

  try {
    await mkdir(join(originPath, 'nested'), { recursive: true });
    await writeFile(join(originPath, 'summary.json'), '{"title":"dir session"}\n');
    await writeFile(join(originPath, 'updates.jsonl'), '{"type":"user","text":"hello"}\n');
    await writeFile(join(originPath, 'nested', 'call.log'), 'log-bytes\n');
  } catch (error) {
    throw new Error(`Could not write session directory ${originPath}`, { cause: error });
  }

  return originPath;
}
