import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173/skoki-i-fiflaki/',
    viewport: { width: 960, height: 540 },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/skoki-i-fiflaki/',
    reuseExistingServer: !process.env['CI'],
    timeout: 30_000,
  },
});
