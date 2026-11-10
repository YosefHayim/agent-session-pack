const commandFlagAliases: Readonly<Record<string, string>> = {
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
  '--watch': 'watch',
  '--savings': 'savings',
  '--scan': 'scan',
  '--unpack': 'unpack',
};

export const rewriteCommandFlagAliases = (argv: ReadonlyArray<string>): ReadonlyArray<string> => {
  const [runtimePath, entrypointPath, firstArg, ...remainingArgumentList] = argv;

  const isInvocationIncomplete = runtimePath == null || entrypointPath == null || firstArg == null;
  if (isInvocationIncomplete) {
    return argv;
  }

  const isFirstArgEmpty = firstArg === '--';
  if (isFirstArgEmpty) {
    return [runtimePath, entrypointPath, ...remainingArgumentList];
  }

  const aliasedCommand = commandFlagAliases[firstArg];

  const isAliasedCommandMissing = aliasedCommand == null;
  if (isAliasedCommandMissing) {
    return argv;
  }

  return [runtimePath, entrypointPath, aliasedCommand, ...remainingArgumentList];
};
