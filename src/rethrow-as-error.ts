export const throwWrappedError = (cause: unknown): never => {
  throw new Error(String(cause), { cause });
};
