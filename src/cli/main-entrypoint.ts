import { realpathSync } from 'node:fs';

export type RealpathFunction = (path: string) => string;

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
