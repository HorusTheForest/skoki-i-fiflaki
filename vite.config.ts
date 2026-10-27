import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /<repo-name>/.
export default defineConfig({
  base: '/skoki-i-fiflaki/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 0,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
