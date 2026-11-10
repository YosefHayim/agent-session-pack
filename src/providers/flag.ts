import { type ProviderAdapter, type ProviderId, ProviderIdSchema } from '@/session-model.js';
import { allProviders } from './all-providers.js';

export const parseOptionalProvider = (provider: string | undefined): ProviderId | undefined => {
  const isProviderMissing = provider == null;
  if (isProviderMissing) {
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

export const selectProviders = (
  provider: string | undefined,
  providersOverride?: ReadonlyArray<ProviderAdapter>,
): ProviderSelection => {
  const hasProvidersOverride = providersOverride != null;
  if (hasProvidersOverride) {
    return { providers: providersOverride, isProviderUnknown: false };
  }

  const isProviderMissing = provider == null;

  if (isProviderMissing) {
    return { providers: allProviders, isProviderUnknown: false };
  }

  const providerId = parseOptionalProvider(provider);

  const isProviderUnknown = providerId == null;

  if (isProviderUnknown) {
    process.stderr.write(`Unknown provider: ${provider}\n`);
    return { providers: [], isProviderUnknown };
  }

  const providersForId = allProviders.filter((adapter) => adapter.id === providerId);
  return { providers: providersForId, isProviderUnknown };
};
