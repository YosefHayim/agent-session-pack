import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'cli/main': 'src/cli/main.ts',
  },
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  dts: true,
  sourcemap: true,
  splitting: false,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
