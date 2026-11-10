// Every command returns this; only the entry file turns exitCode into the process exit code.
export interface CommandExit {
  // 0 ok, 1 failed, 2 bad usage. Watch passes a child process exit code through.
  readonly exitCode: number;
}
