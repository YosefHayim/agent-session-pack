import { Either, Schema } from 'effect';
import { type ProviderAdapter, type ProviderId, ProviderIdSchema } from '../core/sessionStore.js';
import { allProviders } from '../providers/allProviders.js';

/**
 * Parses an optional `--provider` value into a provider id.
 *
 * @param provider - Raw `--provider` flag value.
 * @returns The provider id, or undefined when the flag is missing or unknown.
 * @example
 * ```ts
 * import { parseOptionalProvider } from '../providerFlag.js';
 *
 * parseOptionalProvider('codex');
 * ```
 */
export const parseOptionalProvider = (provider: string | undefined): ProviderId | undefined => {
  if (provider === undefined) {
    return undefined;
  }

  const decoded = Schema.decodeUnknownEither(ProviderIdSchema)(provider);

  return Either.getOrUndefined(decoded);
};

/**
 * Resolves the `--provider` flag to provider adapters, reporting an unknown id with exit code 2.
 *
 * @param provider - Raw `--provider` flag value; undefined selects every provider.
 * @returns Matching provider adapters, or an empty list for an unknown id.
 * @example
 * ```ts
 * import { selectProviders } from '../providerFlag.js';
 *
 * const providers = selectProviders('codex');
 * ```
 */
export const selectProviders = (provider: string | undefined): ReadonlyArray<ProviderAdapter> => {
  if (provider === undefined) {
    return allProviders;
  }

  const providerId = parseOptionalProvider(provider);

  if (providerId === undefined) {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    process.exitCode = 2;
    return [];
  }

  return allProviders.filter((adapter) => adapter.id === providerId);
};
