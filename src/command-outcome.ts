export interface CommandExit {
  // 0 ok, 1 failed, 2 bad usage. Watch passes a child process exit code through.
  readonly exitCode: number;
}
