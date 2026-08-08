import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.test.ts'],
    exclude: ['tests/**/*.integration.test.ts'],
    testTimeout: 30_000,
  },
});
