import { type Effect, Schema } from 'effect';

/**
 * Schema enumerating the supported provider identifiers.
 */
export const ProviderIdSchema = Schema.Literal(
  'codex',
  'claude',
  'kiro',
  'cursor',
  'devin',
  'grok',
  'kimi',
  'opencode',
  'gemini',
);

/**
 * Supported provider identifier value.
 */
export type ProviderId = typeof ProviderIdSchema.Type;

/**
 * Schema enumerating whether a session is stored as one file or a directory tree.
 */
export const SessionSourceKindSchema = Schema.Literal('file', 'directory');

/**
 * Session source storage kind value.
 */
export type SessionSourceKind = typeof SessionSourceKindSchema.Type;

/**
 * Schema enumerating how a provider store may be treated.
 */
export const ProviderModeSchema = Schema.Literal('archive', 'backup-only');

/**
 * Provider handling mode value.
 */
export type ProviderMode = typeof ProviderModeSchema.Type;

/**
 * Schema enumerating lifecycle states a session can occupy.
 */
export const SessionStatusSchema = Schema.Literal(
  'live',
  'cold',
  'archived',
  'restored',
  'pinned',
  'quarantined',
);

/**
 * Session lifecycle status value.
 */
export type SessionStatus = typeof SessionStatusSchema.Type;

/**
 * Schema describing a session discovered in a provider store.
 */
export const DiscoveredSessionSchema = Schema.Struct({
  id: Schema.String,
  provider: ProviderIdSchema,
  title: Schema.String,
  slug: Schema.String,
  originalPath: Schema.String,
  modifiedAt: Schema.DateFromSelf,
  sizeBytes: Schema.Number,
  sourceKind: Schema.optional(SessionSourceKindSchema),
  createdAt: Schema.optional(Schema.DateFromSelf),
  status: Schema.optional(SessionStatusSchema),
  archivePath: Schema.optional(Schema.String),
  savedPercent: Schema.optional(Schema.Number),
});

/**
 * Decoded discovered session record.
 */
export type DiscoveredSession = typeof DiscoveredSessionSchema.Type;

/**
 * Provider store location targeted by a scan.
 */
export type SessionStore = {
  readonly provider: ProviderId;
  readonly path: string;
};

/**
 * Read-only provider adapter used to discover sessions in a store.
 */
export type ProviderAdapter = {
  readonly id: ProviderId;
  readonly label: string;
  readonly mode: ProviderMode;
  readonly defaultRoots: (home: string) => ReadonlyArray<string>;
  readonly discover: (
    store: SessionStore,
  ) => Effect.Effect<ReadonlyArray<DiscoveredSession>, ProviderDiscoveryError>;
};

/**
 * Typed error raised when provider discovery fails.
 */
export class ProviderDiscoveryError extends Schema.TaggedError<ProviderDiscoveryError>()(
  'ProviderDiscoveryError',
  {
    provider: ProviderIdSchema,
    path: Schema.String,
    message: Schema.String,
  },
) {}
