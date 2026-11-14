import { defineConfig } from '@playwright/test';
export default defineConfig({testDir: 'tests/e2e', workers: 1, timeout: process.platform==='win32'?120000:60000, expect: {timeout: 15000}, reporter: 'list', use: {trace: 'retain-on-failure'}});
