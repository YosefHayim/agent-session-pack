import { Effect } from 'effect';
import type { ScanReport } from '../core/index.js';

/**
 * Formats scan output for agents.
 *
 * @param report - Scan report to render.
 * @returns Stable JSON string.
 */
export const formatJsonScan = (report: ScanReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

/**
 * Writes scan output for agents.
 *
 * @param report - Scan report to render.
 * @returns Effect completing after output.
 */
export const renderJsonScan = (report: ScanReport): Effect.Effect<void> =>
  Effect.sync(() => {
    process.stdout.write(formatJsonScan(report));
  });
