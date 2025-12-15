import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureSet, screenshotName } from '../src/capture.js';

describe('screenshotName', () => {
  it('turns paths into file names', () => {
    expect(screenshotName('/')).toBe('home.png');
    expect(screenshotName('/product/2')).toBe('product-2.png');
    expect(screenshotName('/search?q=lamp')).toBe('search.png');
  });
});

const hasBrowser = existsSync(chromium.executablePath());

describe.skipIf(!hasBrowser)('captureSet', () => {
  /** @type {import('node:http').Server} */
  let server;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
      res.end(`<h1 style="font:40px sans-serif">Page ${req.url}</h1>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => new Promise((resolve) => server.close(() => resolve(undefined))));

  it('screenshots every path and reports the HTTP status', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const results = await captureSet({ baseUrl, paths: ['/', '/missing'] }, out, {
      viewport: { width: 400, height: 300 },
      fullPage: false,
      hide: [],
    });
    expect(results.map((r) => [r.path, r.status])).toEqual([
      ['/', 200],
      ['/missing', 404],
    ]);
    expect(existsSync(join(out, 'home.png'))).toBe(true);
  }, 60_000);
});
