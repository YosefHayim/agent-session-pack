import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';
import type { ProviderAdapter } from '../../shared/sessionStore.js';
import { runLocalEvidence } from './localEvidence.js';

const createWorkspace = (): Promise<string> =>
  mkdtemp(join(tmpdir(), 'agent-session-pack-local-evidence-'));

describe('local evidence', () => {
  it('retains discovery counts when every source is too large to sample', async () => {
    const workspace = await createWorkspace();
    const storePath = join(workspace, 'sessions');
    await mkdir(storePath, { recursive: true });
    const provider: ProviderAdapter = {
      id: 'codex',
      label: 'Codex',
      mode: 'archive',
      defaultRoots: () => [storePath],
      discover: () =>
        Effect.succeed([
          {
            id: 'oversized',
            provider: 'codex',
            title: 'Oversized proof source',
            slug: 'oversized-proof-source',
            originalPath: join(storePath, 'oversized.jsonl'),
            modifiedAt: new Date('2026-08-23T12:00:00.000Z'),
            sizeBytes: 30 * 1024 * 1024,
            sourceKind: 'file' as const,
          },
        ]),
    };

    const report = await Effect.runPromise(
      runLocalEvidence({
        home: workspace,
        workRoot: join(workspace, 'proof'),
        providers: [provider],
      }),
    );

    expect(report.evidence).toEqual([
      {
        provider: 'codex',
        foundSessions: 1,
        sampledSources: 0,
        mode: 'archive',
        originalTouched: false,
        maxEvidenceSourceBytes: 25 * 1024 * 1024,
      },
    ]);
  });
});
