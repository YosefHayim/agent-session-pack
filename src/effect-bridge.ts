import { Effect } from 'effect';

/**
 * Runs a promise-based function as an Effect, keeping its error as an Error.
 */
export const promiseAsEffect = <Value>(run: () => Promise<Value>): Effect.Effect<Value, Error> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause), { cause })),
  });
