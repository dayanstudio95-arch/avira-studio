import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: { baseURL: 'http://localhost:8789', locale: 'he-IL' },
  webServer: {
    command: 'rm -rf .wrangler/e2e-state && npx vite build && npx wrangler dev --port 8789 --persist-to .wrangler/e2e-state --var CLOUD_MOCK:1 --var GOOGLE_API_KEY:AIzaTestKey_1234567890abcdefgh',
    url: 'http://localhost:8789/api/health',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
