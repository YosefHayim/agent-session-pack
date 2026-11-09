import { z } from 'zod';

/**
 * Schema enumerating the supported provider identifiers.
 */
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

/**
 * Supported provider identifier value.
 */
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Schema enumerating whether a session is stored as one file or a directory tree.
 */
export const SessionSourceKindSchema = z.enum(['file', 'directory']);

/**
 * Session source storage kind value.
 */
export type SessionSourceKind = z.infer<typeof SessionSourceKindSchema>;

/**
 * Provider handling mode value.
 */
export type ProviderMode = 'archive' | 'backup-only';

/**
 * Lifecycle state a session can occupy.
 */
export type SessionStatus = 'live' | 'cold' | 'archived' | 'restored' | 'pinned' | 'quarantined';

/**
 * A session discovered in a provider store.
 */
export interface DiscoveredSession {
  readonly id: string;
  readonly provider: ProviderId;
  readonly title: string;
  readonly slug: string;
  readonly originalPath: string;
  readonly modifiedAt: Date;
  readonly sizeBytes: number;
  readonly sourceKind?: SessionSourceKind;
  readonly createdAt?: Date;
  readonly status?: SessionStatus;
  readonly archivePath?: string;
  readonly savedPercent?: number;
}

/**
 * Provider store location targeted by a scan.
 */
export type SessionStore = {
  readonly provider: ProviderId;
  readonly path: string;
};

/**
 * Read-only provider adapter used to discover sessions in a store.
 * Discovery throws an Error when the store cannot be read.
 */
export type ProviderAdapter = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (store: SessionStore) => Promise<ReadonlyArray<DiscoveredSession>>;
};
