import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser', workers: 1, timeout: 45000,
  outputDir: '.data/browser-tests/artifacts',
  reporter: [['list'], ['json', { outputFile: '.data/browser-tests/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:3215', channel: process.env.PW_BROWSER ?? 'chrome', headless: true, viewport: { width: 1440, height: 1100 }, serviceWorkers: 'block', screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: {
    command: 'node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3215',
    url: 'http://127.0.0.1:3215', reuseExistingServer: false,
    env: { READ_SOURCE: 'graph', JUDGE_CONTROLS_ENABLED: 'false', ANTHROPIC_API_KEY: '' },
  },
});
