import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 8123);

/**
 * web/ 的端到端冒烟（CI: validate.yml 的 web-smoke job）。
 *
 * 只跑 Chromium：两个壳（WebView2 / Android WebView）都是 Chromium 内核。
 * WKWebView 的差异（安全区、字体）靠真机抽查，见 docs/TENANT-GUIDE.md。
 */
export default defineConfig({
  testDir: './test',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    deviceScaleFactor: 1,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node test/serve.mjs',
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
    env: { PORT: String(PORT) },
  },
});
