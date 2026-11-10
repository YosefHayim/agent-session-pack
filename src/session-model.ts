import { z } from 'zod';

export const ProviderIdSchema = z.enum([
  'codex',
  'claude',
  'kiro',
  'cursor',
  'devin',
  'grok',
  'kimi',
  'opencode',
  'gemini',
]);

export type ProviderId = z.infer<typeof ProviderIdSchema>;

export const SessionOriginKindSchema = z.enum(['file', 'directory']);

export type SessionOriginKind = z.infer<typeof SessionOriginKindSchema>;

export type ProviderMode = 'archive' | 'backup-only';

type SessionStatus = 'live' | 'cold' | 'archived' | 'restored' | 'pinned' | 'quarantined';

export interface DiscoveredSession {
  readonly id: string;
  readonly provider: ProviderId;
  readonly title: string;
  readonly slug: string;
  readonly originalPath: string;
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
  readonly sourceKind?: SessionOriginKind;
  readonly createdAt?: Date;
  readonly status?: SessionStatus;
  readonly archivePath?: string;
  readonly savedPercent?: number;
}

export type SessionStore = {
  readonly provider: ProviderId;
  readonly path: string;
};

export type ProviderAdapter = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (store: SessionStore) => Promise<ReadonlyArray<DiscoveredSession>>;
};
