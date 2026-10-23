import { defineConfig } from '@playwright/test';

// BASE_URL=https://your-app.onrender.com npx playwright test  -> run against a deployed site instead
const live = process.env.BASE_URL;

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: live ? 120000 : 45000, // a deployed site is slower: every step is a network round trip
  expect: { timeout: 8000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: live || 'http://localhost:3100',
    channel: 'chrome', // the Chrome already installed on this machine; no browser download needed
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: live
    ? undefined
    : {
        command: 'node --env-file-if-exists=.env tests/e2e/server.js',
        url: 'http://localhost:3100/api/health',
        reuseExistingServer: false,
        timeout: 90000,
        env: { PORT: '3100', DB_NAME: 'ev_bolts_e2e' },
      },
});
