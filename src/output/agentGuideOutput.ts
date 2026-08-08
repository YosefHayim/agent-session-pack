const ONE_OFF_PREFIX = 'npx --yes agent-session-pack';

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
    readonly restoreOne: string;
    readonly ensureRestored: string;
    readonly lifecycleEnable: string;
    readonly lifecycleStatus: string;
  };
  readonly providers: ReadonlyArray<string>;
  readonly notes: ReadonlyArray<string>;
};

const RECOMMENDED_FLOW: ReadonlyArray<AgentGuideStep> = [
  {
    id: 'proof',
    purpose: 'Copy-only proof. Shows local before/after savings without touching originals.',
    command: `${ONE_OFF_PREFIX} check --json`,
  },
  {
    id: 'dry-run-pack',
    purpose: 'Plan cold-session packing across discovered providers without removing originals.',
    command: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --dry-run --json`,
  },
  {
    id: 'apply-pack',
    purpose: 'Archive and remove only after byte-exact restore verification and manifest writes.',
    command: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --apply --yes --json`,
  },
  {
    id: 'restore',
    purpose: 'Restore archived sessions back to original provider paths when needed.',
    command: `${ONE_OFF_PREFIX} unpack --all-providers --apply --yes --json`,
  },
  {
    id: 'ensure-restored',
    purpose:
      'Before resume, restore one archived session when restore-on-launch lifecycle is enabled.',
    command: `${ONE_OFF_PREFIX} ensure-restored --provider codex <session-id> --json`,
  },
];

const AGENT_GUIDE: AgentGuide = {
  name: 'agent-session-pack',
  mode: 'agent-guide',
  summary: 'Agent-safe command map for local AI coding-agent session cold storage.',
  safety: {
    bareCommand: 'human-tty-only',
    defaultMutation: 'none',
    machineOutput: '--json',
    applyConfirmation: '--apply --yes',
  },
  recommendedFlow: RECOMMENDED_FLOW,
  commands: {
    humanSetup: `${ONE_OFF_PREFIX}`,
    doctor: `${ONE_OFF_PREFIX} doctor --json`,
    scan: `${ONE_OFF_PREFIX} scan --json`,
    check: `${ONE_OFF_PREFIX} check --json`,
    dryRunPack: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --dry-run --json`,
    maxPreview: `${ONE_OFF_PREFIX} pack --max --dry-run --json`,
    applyPack: `${ONE_OFF_PREFIX} pack --all-providers --older-than 7d --apply --yes --json`,
    applyUnpack: `${ONE_OFF_PREFIX} unpack --all-providers --apply --yes --json`,
    restoreOne: `${ONE_OFF_PREFIX} restore <selector> --json`,
    ensureRestored: `${ONE_OFF_PREFIX} ensure-restored --provider codex <session-id> --json`,
    lifecycleEnable: `${ONE_OFF_PREFIX} lifecycle enable --json`,
    lifecycleStatus: `${ONE_OFF_PREFIX} lifecycle status --json`,
  },
  providers: ['codex', 'claude', 'kiro', 'grok', 'kimi', 'opencode', 'gemini', 'cursor', 'devin'],
  notes: [
    'Prefer explicit subcommands with --json.',
    'Bare agent-session-pack is for human TTY setup.',
    'Use --dry-run before any --apply command.',
    'Use --max --dry-run to preview every archive-mode session without touching files.',
    'Use --older-than 1d to skip recent sessions from roughly the last 24 hours.',
    'Opt in to restore-on-launch with lifecycle enable, then call ensure-restored before resume.',
  ],
};

/**
 * Formats a compact terminal guide for coding agents and script authors.
 *
 * @returns Human-readable agent command guide.
 * @example
 * ```ts
 * import { formatHumanAgentGuide } from './agentGuideOutput.js';
 *
 * formatHumanAgentGuide();
 * ```
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
    ...RECOMMENDED_FLOW.map((step, index) =>
      [`${index + 1}. ${step.purpose}`, `   ${step.command}`].join('\n'),
    ),
    '',
    'Curiosity preview',
    `${ONE_OFF_PREFIX} pack --max --dry-run --json`,
    '',
    'Restore-on-launch (opt-in)',
    `${ONE_OFF_PREFIX} lifecycle enable --json`,
    `${ONE_OFF_PREFIX} ensure-restored --provider codex <session-id> --json`,
    `${ONE_OFF_PREFIX} restore <selector> --json`,
    '',
    'Provider ids',
    'codex, claude, kiro, grok, kimi, opencode, gemini, cursor, devin',
    '',
    'More help',
    'agent-session-pack <command> --help',
    'agent-session-pack guide --json',
  ].join('\n');

/**
 * Formats the agent guide as stable JSON.
 *
 * @returns Machine-readable agent command guide.
 * @example
 * ```ts
 * import { formatJsonAgentGuide } from './agentGuideOutput.js';
 *
 * formatJsonAgentGuide();
 * ```
 */
export const formatJsonAgentGuide = (): string => `${JSON.stringify(AGENT_GUIDE, null, 2)}\n`;
