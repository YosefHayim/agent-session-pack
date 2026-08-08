const COMMAND_FLAG_ALIASES: Readonly<Record<string, string>> = {
  '--check': 'check',
  '--doctor': 'doctor',
  '--guide': 'guide',
  '--init': 'init',
  '--list': 'list',
  '--lifecycle': 'lifecycle',
  '--maintain': 'maintain',
  '--open': 'open',
  '--pack': 'pack',
  '--preflight': 'preflight',
  '--restore': 'restore',
  '--savings': 'savings',
  '--scan': 'scan',
  '--unpack': 'unpack',
};

/**
 * Rewrites pnpm-friendly command flag aliases into citty subcommands.
 *
 * @param argv - Raw process argv.
 * @returns Argv with supported command aliases rewritten as subcommands.
 * @example
 * ```ts
 * import { rewriteCommandFlagAliases } from './mainArgs.js';
 *
 * const argv = rewriteCommandFlagAliases(['node', 'cli.js', '--scan']);
 * ```
 */
export const rewriteCommandFlagAliases = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [runtimePath, entrypointPath, firstArg, ...remainingArgs] = argv;

  if (runtimePath === undefined || entrypointPath === undefined || firstArg === undefined) {
    return argv;
  }

  if (firstArg === '--') {
    return [runtimePath, entrypointPath, ...remainingArgs];
  }

  const aliasedCommand = COMMAND_FLAG_ALIASES[firstArg];

  if (aliasedCommand === undefined) {
    return argv;
  }

  return [runtimePath, entrypointPath, aliasedCommand, ...remainingArgs];
};
