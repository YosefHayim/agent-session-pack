import { realpathSync } from 'node:fs';

/**
 * Resolves a filesystem path, following symlinks.
 */
export type RealpathFunction = (path: string) => string;

/**
 * Checks whether the current module was launched as the CLI entrypoint.
 *
 * @param entrypointPath - Raw `process.argv[1]` path.
 * @param modulePath - Current module path.
 * @param realpath - Resolver used to follow npm bin symlinks.
 * @returns True when the current module should run the CLI.
 * @example
 * ```ts
 * import { isCliEntrypoint } from './main-entrypoint.js';
 *
 * const isEntry = isCliEntrypoint(process.argv[1], import.meta.url);
 * ```
 */
export const isCliEntrypoint = (
  entrypointPath: string | undefined,
  modulePath: string,
  realpath: RealpathFunction = realpathSync,
): boolean => {
  const isEntrypointPathMissing = entrypointPath == null;
  if (isEntrypointPathMissing) {
    return false;
  }

  return realpath(entrypointPath) === realpath(modulePath);
};
