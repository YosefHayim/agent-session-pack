import { Effect } from 'effect';
import { homeNotSetStderrMessage } from '../src/cli/homeEnv.js';
import type { ArchiveWriteError } from '../src/core/archiveWriter.js';
import { resolveEvidenceWorkRoot } from '../src/core/evidenceWorkRoot.js';
import { runLocalEvidence } from '../src/core/localEvidence.js';
import type { ProviderDiscoveryError } from '../src/core/sessionStore.js';
import {
  formatHumanEvidenceReport,
  formatJsonEvidenceReport,
} from '../src/output/evidenceOutput.js';
import { allProviders } from '../src/providers/allProviders.js';

/**
 * Runs opt-in local evidence against copied provider sessions.
 *
 * @returns Effect that prints local evidence.
 * @example
 * ```ts
 * import { Effect } from 'effect';
 * import { runEvidenceLocal } from './evidenceLocal.js';
 *
 * await Effect.runPromise(runEvidenceLocal());
 * ```
 */
export const runEvidenceLocal = (): Effect.Effect<
  void,
  ArchiveWriteError | ProviderDiscoveryError
> =>
  Effect.gen(function* () {
    const home = process.env.HOME;

    if (home === undefined) {
      process.stderr.write(homeNotSetStderrMessage);
      process.exitCode = 1;
      return;
    }

    const workRoot = resolveEvidenceWorkRoot(process.cwd(), String(process.pid));
    const report = yield* runLocalEvidence({
      home,
      workRoot,
      providers: allProviders,
    });

    if (process.argv.includes('--json')) {
      process.stdout.write(formatJsonEvidenceReport(report));
      return;
    }

    process.stdout.write(`${formatHumanEvidenceReport(report)}\n`);
  });

await Effect.runPromise(runEvidenceLocal()).catch((error: unknown) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
