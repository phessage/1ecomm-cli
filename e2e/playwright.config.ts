import { defineConfig } from '@playwright/test';
import { MATRIX } from './matrix.js';
import { readFileSync, existsSync } from 'node:fs';
import { MANIFEST_PATH, type Manifest } from './global-setup.js';

/**
 * One Playwright project per matrix entry.
 *
 * `baseURL` cannot be known until globalSetup has built and served each entry,
 * and `config.use` is evaluated BEFORE globalSetup runs — so it is read from the
 * manifest at spec time instead, through the `project` fixture. Gating on the
 * manifest FILE rather than an env var matters: workers are separate processes
 * and never see the setup process's environment.
 */
const built: Manifest | null = existsSync(MANIFEST_PATH)
  ? (JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest)
  : null;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  // Never serial: the first failure would skip the rest, so inverting an
  // assertion to prove the suite can fail would report one result instead of all.
  fullyParallel: true,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  workers: process.env['CI'] ? 2 : 4,
  reporter: process.env['CI'] ? [['github'], ['list']] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: MATRIX.map((entry) => ({
    name: entry.id,
    use: {
      baseURL: built?.projects.find((p) => p.id === entry.id)?.baseURL ?? 'http://localhost:0',
    },
  })),
});
