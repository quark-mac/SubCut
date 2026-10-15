import { defineConfig } from '@playwright/test';
import path from 'node:path';

const python = process.env.WEBUI_PYTHON || 'python';
const root = path.resolve('.test-workspace');

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:18761',
    channel: process.env.WEBUI_BROWSER || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure',
  },
  webServer: {
    command: `"${python}" -m webui.tests.serve --port 18761 --root "${root}"`,
    cwd: '../..',
    url: 'http://127.0.0.1:18761/api/health',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
