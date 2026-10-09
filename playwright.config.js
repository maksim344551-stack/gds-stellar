import { defineConfig, devices } from '@playwright/test';

// Программная отрисовка WebGL (SwiftShader): на машине без видеокарты, в том числе на сервере сборки, сцена всё равно рисуется, хотя медленно.
const softwareGl = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    command: 'npx vite --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 810 }, launchOptions: { args: softwareGl } } },
    { name: 'chromium-phone', use: { ...devices['Pixel 7'], launchOptions: { args: softwareGl } } },
    { name: 'firefox-desktop', use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 810 } } },
    { name: 'webkit-phone', use: { ...devices['iPhone 13'] } },
  ],
});
