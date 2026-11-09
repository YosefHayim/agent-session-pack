import { type ProviderAdapter, type ProviderId, ProviderIdSchema } from '@/session-model.js';
import { allProviders } from './all-providers.js';

/**
 * Parses an optional `--provider` value into a provider id, or undefined when missing or unknown.
 */
export const parseOptionalProvider = (provider: string | undefined): ProviderId | undefined => {
  if (provider === undefined) {
    return undefined;
  }

  const providerReply = ProviderIdSchema.safeParse(provider);
  const isProviderKnown = providerReply.success;

  return isProviderKnown ? providerReply.data : undefined;
};

/**
 * Resolves the `--provider` flag to provider adapters, reporting an unknown id with exit code 2.
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
