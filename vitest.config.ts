import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

// Core tests run in Node. Component tests (M6) opt into jsdom per file with
// `// @vitest-environment jsdom`.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: [
        'src/**/*.test.{ts,tsx}',
        'generator/**/*.test.ts',
        'scripts/**/*.test.ts',
        'supabase/functions/**/*.test.ts',
      ],
      environment: 'node',
      // The zip-bomb fixtures inflate tens of megabytes in-test.
      testTimeout: 60_000,
    },
  }),
);
