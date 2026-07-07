const oneOffPrefix = 'npx --yes agent-session-pack';

type AgentGuideStep = {
  readonly id: string;
  readonly purpose: string;
  readonly command: string;
};

type AgentGuide = {
  readonly name: 'agent-session-pack';
  readonly mode: 'agent-guide';
  readonly summary: string;
  readonly safety: {
    readonly bareCommand: 'human-tty-only';
    readonly defaultMutation: 'none';
    readonly machineOutput: '--json';
    readonly applyConfirmation: '--apply --yes';
  };
  readonly recommendedFlow: ReadonlyArray<AgentGuideStep>;
  readonly commands: {
    readonly humanSetup: string;
    readonly doctor: string;
    readonly scan: string;
    readonly check: string;
    readonly dryRunPack: string;
    readonly maxPreview: string;
    readonly applyPack: string;
    readonly applyUnpack: string;
  };
  readonly providers: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
};

const recommendedFlow: ReadonlyArray<AgentGuideStep> = [
  {
    id: 'proof',
    purpose: 'Copy-only proof. Shows local before/after savings without touching originals.',
    command: `${oneOffPrefix} check --json`,
  },
  {
    id: 'dry-run-pack',
    purpose: 'Plan cold-session packing across discovered providers without removing originals.',
    command: `${oneOffPrefix} pack --all-providers --older-than 7d --dry-run --json`,
  },
  {
    id: 'apply-pack',
    purpose: 'Archive and remove only after byte-exact restore verification and manifest writes.',
    command: `${oneOffPrefix} pack --all-providers --older-than 7d --apply --yes --json`,
  },
  {
    id: 'restore',
    purpose: 'Restore archived sessions back to original provider paths when needed.',
    command: `${oneOffPrefix} unpack --all-providers --apply --yes --json`,
  },
];

const agentGuide: AgentGuide = {
  name: 'agent-session-pack',
  mode: 'agent-guide',
  summary: 'Agent-safe command map for local AI coding-agent session cold storage.',
  safety: {
    bareCommand: 'human-tty-only',
    defaultMutation: 'none',
    machineOutput: '--json',
    applyConfirmation: '--apply --yes',
  },
  recommendedFlow,
  commands: {
    humanSetup: `${oneOffPrefix}`,
    doctor: `${oneOffPrefix} doctor --json`,
    scan: `${oneOffPrefix} scan --json`,
    check: `${oneOffPrefix} check --json`,
    dryRunPack: `${oneOffPrefix} pack --all-providers --older-than 7d --dry-run --json`,
    maxPreview: `${oneOffPrefix} pack --max --dry-run --json`,
    applyPack: `${oneOffPrefix} pack --all-providers --older-than 7d --apply --yes --json`,
    applyUnpack: `${oneOffPrefix} unpack --all-providers --apply --yes --json`,
  },
  providers: ['codex', 'claude', 'kiro', 'cursor', 'devin'],
  notes: [
    'Prefer explicit subcommands with --json.',
    'Bare agent-session-pack is for human TTY setup.',
    'Use --dry-run before any --apply command.',
    'Use --max --dry-run to preview every archive-mode session without touching files.',
    'Use --older-than 1d to skip recent sessions from roughly the last 24 hours.',
  ],
};

/**
 * Formats a compact terminal guide for coding agents and script authors.
 *
 * @returns Human-readable agent command guide.
 */
export const formatHumanAgentGuide = (): string =>
  [
    'Agent-first quickstart',
    '',
    'Rules',
    '- Prefer explicit subcommands with --json.',
    '- Bare agent-session-pack is for human TTY setup.',
    '- Nothing mutates provider sessions until --apply is present.',
    '- Use --dry-run before --apply, then use --yes only for non-interactive execution.',
    '',
    'Safe flow',
    ...recommendedFlow.map((step, index) =>
      [`${index + 1}. ${step.purpose}`, `   ${step.command}`].join('\n'),
    ),
    '',
    'Curiosity preview',
    `${oneOffPrefix} pack --max --dry-run --json`,
    '',
    'Provider ids',
    'codex, claude, kiro, cursor, devin',
    '',
    'More help',
    'agent-session-pack <command> --help',
    'agent-session-pack guide --json',
  ].join('\n');

/**
 * Formats the agent guide as stable JSON.
 *
 * @returns Machine-readable agent command guide.
 */
export const formatJsonAgentGuide = (): string => `${JSON.stringify(agentGuide, null, 2)}\n`;
