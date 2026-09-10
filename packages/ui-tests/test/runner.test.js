import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playwrightConfig, runSuite } from '../src/runner.js';

const testDir = join(import.meta.dirname, 'fixtures', 'suite');

describe('playwrightConfig', () => {
  it('points Playwright at the suite and the run folder', () => {
    const source = playwrightConfig(
      { testDir, baseUrl: 'https://shop.ddev.site', retries: 0, workers: 1, timeoutSeconds: 5 },
      '/runs/1',
      { username: 'qa', password: 'x' },
    );
    expect(source).toContain('"baseURL": "https://shop.ddev.site"');
    expect(source).toContain('"outputFile": "/runs/1/results.json"');
    expect(source).toContain('"httpCredentials"');
  });
});

describe.skipIf(!existsSync(chromium.executablePath()))('runSuite', () => {
  /** @type {import('node:http').Server} */
  let server;
  let baseUrl = '';
  let aboutTitle = 'About the shop';

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<h1>${req.url === '/about' ? aboutTitle : 'Home'}</h1>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => new Promise((resolve) => server.close(() => resolve(undefined))));

  const suite = () => ({ testDir, baseUrl, retries: 0, workers: 1, timeoutSeconds: 15 });

  it('reports a passing suite', async () => {
    const outputDir = await mkdtemp(join(tmpdir(), 'dops-ui-'));
    const run = await runSuite('smoke', suite(), { outputDir });
    expect(run.status).toBe('passed');
    expect(run.stats).toMatchObject({ passed: 2, failed: 0 });
    expect(existsSync(join(run.reportDir, 'index.html'))).toBe(true);
  }, 120_000);

  it('lists failing tests with their first error line', async () => {
    aboutTitle = 'Our story';
    const outputDir = await mkdtemp(join(tmpdir(), 'dops-ui-'));
    const run = await runSuite('smoke', suite(), { outputDir });
    expect(run.status).toBe('failed');
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0]).toMatchObject({ title: 'pages › about mentions the shop' });
    expect(run.failures[0]?.error).toMatch(/toHaveText/);
  }, 120_000);
});
