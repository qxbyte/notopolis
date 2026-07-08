import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60000,
  outputDir: '.superpowers/e2e-artifacts',
  reporter: [['html', { open: 'never' }]],
  use: {
    // e2e 测试通过后端的静态托管访问前端（web/dist）
    baseURL: 'http://localhost:4777',
  },
  webServer: [
    {
      command:
        'NOTOPOLIS_CONFIG_DIR=.superpowers/e2e-config NOTOPOLIS_PORT=4777 npm run dev',
      port: 4777,
      reuseExistingServer: false,
      timeout: 30000,
    },
  ],
});
