/**
 * Turns a failed call into an Error that keeps the original cause and its text.
 */
export const rethrowAsError = (cause: unknown): never => {
  throw new Error(String(cause), { cause });
};
