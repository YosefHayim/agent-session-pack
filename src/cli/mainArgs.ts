const commandFlagAliases: Readonly<Record<string, string>> = {
  '--doctor': 'doctor',
  '--init': 'init',
  '--list': 'list',
  '--pack': 'pack',
  '--restore': 'restore',
  '--scan': 'scan',
};

/**
 * Normalizes pnpm-friendly command aliases before citty parses argv.
 *
 * @param argv - Raw process argv.
 * @returns Argv with supported command aliases rewritten as subcommands.
 */
export const normalizeCliArgv = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [runtimePath, entrypointPath, firstArg, ...remainingArgs] = argv;

  if (runtimePath === undefined || entrypointPath === undefined || firstArg === undefined) {
    return argv;
  }

  if (firstArg === '--') {
    return [runtimePath, entrypointPath, ...remainingArgs];
  }

  const aliasedCommand = commandFlagAliases[firstArg];

  if (aliasedCommand === undefined) {
    return argv;
  }

  return [runtimePath, entrypointPath, aliasedCommand, ...remainingArgs];
};
