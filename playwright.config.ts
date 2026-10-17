import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/ui',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'chromium-fixtures',
      use: {
        browserName: 'chromium',
        launchOptions: {
          executablePath: process.env.LATERSIFT_CHROMIUM_PATH,
          args: ['--no-sandbox'],
        },
      },
    },
    { name: 'firefox-fixtures', use: { browserName: 'firefox' } },
  ],
  webServer: {
    command:
      'node_modules/.bin/vite preview --host 127.0.0.1 --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
});
