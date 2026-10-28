import { defineConfig } from 'vitest/config';

// Needs the Docker SSH hosts from test/integration/run.sh.
export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.js'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
