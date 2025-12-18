import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureSet, httpCredentials, screenshotName } from '../src/capture.js';

describe('screenshotName', () => {
  it('turns paths into file names', () => {
    expect(screenshotName('/')).toBe('home.png');
    expect(screenshotName('/product/2')).toBe('product-2.png');
    expect(screenshotName('/search?q=lamp')).toBe('search.png');
  });
});

describe('httpCredentials', () => {
  const urlSet = {
    baseUrl: 'https://stage.example.com',
    paths: ['/'],
    httpAuth: { usernameEnv: 'STAGE_USER', passwordEnv: 'STAGE_PASS' },
  };

  it('reads credentials from the environment', () => {
    expect(httpCredentials(urlSet, { STAGE_USER: 'qa', STAGE_PASS: 's3cret' })).toEqual({
      username: 'qa',
      password: 's3cret',
    });
  });

  it('names the missing variables', () => {
    expect(() => httpCredentials(urlSet, { STAGE_USER: 'qa' })).toThrow(/STAGE_PASS/);
  });

  it('is undefined when the set has no auth', () => {
    expect(httpCredentials({ baseUrl: urlSet.baseUrl, paths: ['/'] }, {})).toBeUndefined();
  });
});

const hasBrowser = existsSync(chromium.executablePath());

describe.skipIf(!hasBrowser)('captureSet', () => {
  /** @type {import('node:http').Server} */
  let server;
  let baseUrl = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/private') {
        const expected = `Basic ${Buffer.from('qa:s3cret').toString('base64')}`;
        if (req.headers.authorization !== expected) {
          res.writeHead(401, { 'www-authenticate': 'Basic realm="stage"' });
          res.end();
          return;
        }
      }
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

  it('sends basic auth credentials from the environment', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const urlSet = {
      baseUrl,
      paths: ['/private'],
      httpAuth: { usernameEnv: 'STAGE_USER', passwordEnv: 'STAGE_PASS' },
    };
    const options = { viewport: { width: 400, height: 300 }, fullPage: false, hide: [] };
    const [result] = await captureSet(urlSet, out, options, undefined, {
      STAGE_USER: 'qa',
      STAGE_PASS: 's3cret',
    });
    expect(result?.status).toBe(200);
  }, 60_000);
});
