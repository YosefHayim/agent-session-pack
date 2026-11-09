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

export interface ProviderSelection {
  readonly providers: ReadonlyArray<ProviderAdapter>;
  readonly isProviderUnknown: boolean;
}

/**
 * Resolves the `--provider` flag to provider adapters. An unknown id is written to stderr and flagged;
 * a provider list the caller already has wins over the flag.
 */
export const selectProviders = (
  provider: string | undefined,
  providersOverride?: ReadonlyArray<ProviderAdapter>,
): ProviderSelection => {
  if (providersOverride !== undefined) {
    return { providers: providersOverride, isProviderUnknown: false };
  }

  const isProviderMissing = provider === undefined;

  if (isProviderMissing) {
    return { providers: allProviders, isProviderUnknown: false };
  }

  const providerId = parseOptionalProvider(provider);
  const isProviderUnknown = providerId === undefined;

  if (isProviderUnknown) {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    return { providers: [], isProviderUnknown };
  }

  const providersForId = allProviders.filter((adapter) => adapter.id === providerId);
  return { providers: providersForId, isProviderUnknown };
};
