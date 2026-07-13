import { Effect, Schema } from 'effect';
import {
  type DiscoveredSession,
  DiscoveredSessionSchema,
  type ProviderId,
  type ProviderIdSchema,
  slugifyTitle,
} from './sessionStore.js';

/**
 * Selector text paired with the sessions it should resolve against.
 */
export type SessionSelectorRequest = {
  readonly selector: string;
  readonly sessions: ReadonlyArray<DiscoveredSession>;
};

type ParsedSelector = {
  readonly provider: ProviderId | undefined;
  readonly query: string;
};

/**
 * Typed error raised when a selector matches no session.
 */
export class SessionSelectorNotFoundError extends Schema.TaggedError<SessionSelectorNotFoundError>()(
  'SessionSelectorNotFoundError',
  {
    selector: Schema.String,
  },
) {}

/**
 * Typed error raised when a selector matches more than one session.
 */
export class SessionSelectorAmbiguousError extends Schema.TaggedError<SessionSelectorAmbiguousError>()(
  'SessionSelectorAmbiguousError',
  {
    selector: Schema.String,
    candidates: Schema.Array(DiscoveredSessionSchema),
  },
) {}

/**
 * Union of errors a selector resolution can produce.
 */
export type SessionSelectorError = SessionSelectorNotFoundError | SessionSelectorAmbiguousError;

/**
 * Resolves a human or agent selector to one session.
 *
 * @param request - Selector text and candidate sessions.
 * @returns Effect containing the resolved session or typed selector error.
 * @example
 * ```ts
 * import { resolveSessionSelector } from './sessionSelector.js';
 *
 * const session = await Effect.runPromise(
 *   resolveSessionSelector({ selector: 'codex:fix-login', sessions }),
 * );
 * ```
 */
export const resolveSessionSelector = (
  request: SessionSelectorRequest,
): Effect.Effect<DiscoveredSession, SessionSelectorError> =>
  Effect.gen(function* () {
    const parsed = parseSelector(request.selector);
    const candidates = filterProvider(request.sessions, parsed.provider);
    const matches = matchingSessions(parsed.query, candidates);

    if (matches.length === 0) {
      return yield* Effect.fail(
        new SessionSelectorNotFoundError({
          selector: request.selector,
        }),
      );
    }

    if (matches.length > 1) {
      return yield* Effect.fail(
        new SessionSelectorAmbiguousError({
          selector: request.selector,
          candidates: matches,
        }),
      );
    }

    return matches[0];
  });

const parseSelector = (selector: string): ParsedSelector => {
  const prefixMatch = selector.match(/^(codex|claude|kiro|cursor|devin):(.+)$/);

  if (prefixMatch === null) {
    return {
      provider: undefined,
      query: selector.trim(),
    };
  }

  return {
    provider: prefixMatch[1] as typeof ProviderIdSchema.Type,
    query: prefixMatch[2].trim(),
  };
};

const filterProvider = (
  sessions: ReadonlyArray<DiscoveredSession>,
  provider: ProviderId | undefined,
): ReadonlyArray<DiscoveredSession> => {
  if (provider === undefined) {
    return sessions;
  }

  return sessions.filter((session) => session.provider === provider);
};

const matchingSessions = (
  query: string,
  sessions: ReadonlyArray<DiscoveredSession>,
): ReadonlyArray<DiscoveredSession> => {
  const normalizedQuery = query.toLowerCase();
  const slugQuery = slugifyTitle(query);
  const idMatches = sessions.filter((session) => session.id.startsWith(query));

  if (idMatches.length > 0) {
    return idMatches;
  }

  const exactMatches = sessions.filter(
    (session) =>
      session.title.toLowerCase() === normalizedQuery || session.slug.toLowerCase() === slugQuery,
  );

  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const tokens = slugQuery.split('-').filter((token) => token.length > 0);

  return sessions.filter((session) =>
    tokens.every(
      (token) => session.slug.includes(token) || session.title.toLowerCase().includes(token),
    ),
  );
};
