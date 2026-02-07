import { defineConfig } from 'tsup';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  entry: [
    'src/cli.ts',
    'src/sync/engine.ts',
    'src/store/jsonStore.ts',
    'src/store/lock.ts',
    'src/providers/google.ts',
    'src/providers/microsoft.ts',
    'src/providers/mock.ts',
    'src/providers/provider.ts',
    'src/model.ts',
    'src/http.ts',
    'src/config.ts',
    'src/log.ts',
    'src/env.ts',
  ],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  dts: true,
  splitting: true,
  async onSuccess() {
    // Add shebang only to the CLI entry point
    const cliPath = 'dist/cli.js';
    const content = readFileSync(cliPath, 'utf8');
    if (!content.startsWith('#!')) {
      writeFileSync(cliPath, '#!/usr/bin/env node\n' + content);
    }
  },
});
