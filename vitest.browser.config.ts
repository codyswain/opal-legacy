import { defineConfig } from 'vitest/config';
import unitConfig from './vitest.config';

export default defineConfig({
  resolve: unitConfig.resolve,
  optimizeDeps: { include: ['react/jsx-dev-runtime'] },
  test: {
    include: ['src/tests/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
      headless: true,
      fileParallelism: false,
      viewport: { width: 1280, height: 800 },
    },
  },
});
