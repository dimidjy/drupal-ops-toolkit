import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  assertSafeLabel,
  brokenReason,
  captureSet,
  forEnvironment,
  httpCredentials,
  pageUrl,
  screenshotName,
  stripCacheBust,
  verifyNavigation,
} from '../src/capture.js';

describe('assertSafeLabel', () => {
  it('accepts ticket-style labels', () => {
    expect(() => assertSafeLabel('SHOP-42-before')).not.toThrow();
  });

  it('rejects labels that could leave the output folder', () => {
    for (const label of ['../..', 'a/b', '.hidden', '']) {
      expect(() => assertSafeLabel(label)).toThrow(/Bad capture label/);
    }
  });
});

describe('pageUrl', () => {
  it('resolves paths on the site', () => {
    expect(pageUrl('/products?page=2', 'https://stage.example.com').href).toBe(
      'https://stage.example.com/products?page=2',
    );
  });

  it('rejects paths that point to another host', () => {
    expect(() => pageUrl('//evil.example.org/x', 'https://stage.example.com')).toThrow(
      /leaves the site/,
    );
    expect(() => pageUrl('/\t/evil.example.org', 'https://stage.example.com')).toThrow(
      /leaves the site/,
    );
  });
});

describe('stripCacheBust', () => {
  it('drops the cache-busting parameter from URLs and messages', () => {
    expect(stripCacheBust('https://a.test/x?_dops=123')).toBe('https://a.test/x');
    expect(stripCacheBust('https://a.test/x?q=1&_dops=123 failed')).toBe(
      'https://a.test/x?q=1 failed',
    );
  });
});

describe('brokenReason', () => {
  it('passes a page that loaded', () => {
    expect(brokenReason({ status: 200 })).toBeUndefined();
  });

  it('explains why a page cannot pass', () => {
    expect(brokenReason({ status: 401 })).toBe('HTTP 401');
    expect(brokenReason({ status: 0 })).toBe('no response');
    expect(brokenReason({ status: 200, fatal: 'Fatal error:' })).toBe('error page: Fatal error:');
    expect(brokenReason({ status: 0, blocked: 'navigation outside the URL set: x' })).toMatch(
      /outside/,
    );
  });
});

describe('verifyNavigation', () => {
  const allowed = new Set(['https://stage.example.com']);

  /**
   * @param {Record<string, { status: number, location?: string } | Error>} hops
   */
  const fakeRoute = (hops) => {
    /** @type {string[]} */
    const fetched = [];
    return {
      fetched,
      /** @param {{ url: string }} options */
      fetch: async ({ url }) => {
        fetched.push(url);
        const hop = hops[url];
        if (!hop) throw new Error(`unexpected fetch ${url}`);
        if (hop instanceof Error) throw hop;
        return {
          status: () => hop.status,
          headers: () => (hop.location ? { location: hop.location } : {}),
        };
      },
    };
  };

  it('returns the first response when every hop stays on the site', async () => {
    const route = fakeRoute({
      'https://stage.example.com/a': { status: 301, location: '/b' },
      'https://stage.example.com/b': { status: 200 },
    });
    const verdict = await verifyNavigation(route, 'https://stage.example.com/a', allowed, 1000);
    expect('response' in verdict && verdict.response.status()).toBe(301);
  });

  it('stops a second hop that leaves the site before requesting it', async () => {
    const route = fakeRoute({
      'https://stage.example.com/a': { status: 302, location: '/b' },
      'https://stage.example.com/b': { status: 302, location: 'https://www.example.com/b' },
    });
    const verdict = await verifyNavigation(route, 'https://stage.example.com/a', allowed, 1000);
    expect(verdict).toEqual({
      blocked: 'navigation outside the URL set: https://www.example.com/b',
    });
    expect(route.fetched).not.toContain('https://www.example.com/b');
  });

  it('blocks when a hop cannot be checked', async () => {
    const route = fakeRoute({ 'https://stage.example.com/a': new Error('certificate error') });
    const verdict = await verifyNavigation(route, 'https://stage.example.com/a', allowed, 1000);
    expect(verdict).toEqual({
      blocked: 'could not check https://stage.example.com/a: certificate error',
    });
  });
});

describe('screenshotName', () => {
  it('turns paths into file names', () => {
    expect(screenshotName('/')).toBe('home.png');
    expect(screenshotName('/product/2')).toBe('product-2.png');
    expect(screenshotName('/search?q=lamp')).toBe('search.png');
  });
});

describe('forEnvironment', () => {
  const urlSet = {
    baseUrl: 'https://stage.example.com',
    paths: ['/'],
    environments: { prod: 'https://www.example.com' },
  };

  it('swaps the base URL', () => {
    expect(forEnvironment(urlSet, 'prod').baseUrl).toBe('https://www.example.com');
    expect(forEnvironment(urlSet).baseUrl).toBe('https://stage.example.com');
  });

  it('lists known environments on a typo', () => {
    expect(() => forEnvironment(urlSet, 'prd')).toThrow(/Unknown environment "prd" \(prod\)/);
  });
});

describe('httpCredentials', () => {
  const urlSet = {
    baseUrl: 'https://stage.example.com',
    paths: ['/'],
    environments: {},
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
    expect(
      httpCredentials({ baseUrl: urlSet.baseUrl, paths: ['/'], environments: {} }, {}),
    ).toBeUndefined();
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
      const delay = req.url === '/slow' ? 500 : 0;
      setTimeout(() => {
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'text/html' });
        res.end(`<h1 style="font:40px sans-serif">Page ${req.url}</h1>`);
      }, delay);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => new Promise((resolve) => server.close(() => resolve(undefined))));

  it('screenshots every path and reports the HTTP status', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const results = await captureSet({ baseUrl, paths: ['/', '/missing'], environments: {} }, out, {
      viewport: { width: 400, height: 300 },
      fullPage: false,
      hide: [],
      concurrency: 2,
    });
    expect(results.map((r) => [r.path, r.status])).toEqual([
      ['/', 200],
      ['/missing', 404],
    ]);
    expect(existsSync(join(out, 'home.png'))).toBe(true);
  }, 60_000);

  it('captures pages in parallel but returns them in order', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    /** @type {string[]} */
    const finished = [];
    const results = await captureSet(
      { baseUrl, paths: ['/slow', '/fast'], environments: {} },
      out,
      { viewport: { width: 400, height: 300 }, fullPage: false, hide: [], concurrency: 2 },
      (result) => finished.push(result.path),
    );
    expect(finished).toEqual(['/fast', '/slow']);
    expect(results.map((r) => r.path)).toEqual(['/slow', '/fast']);
  }, 60_000);

  it('sends basic auth credentials from the environment', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const urlSet = {
      baseUrl,
      paths: ['/private'],
      environments: {},
      httpAuth: { usernameEnv: 'STAGE_USER', passwordEnv: 'STAGE_PASS' },
    };
    const options = {
      viewport: { width: 400, height: 300 },
      fullPage: false,
      hide: [],
      concurrency: 1,
    };
    const [result] = await captureSet(urlSet, out, options, undefined, {
      STAGE_USER: 'qa',
      STAGE_PASS: 's3cret',
    });
    expect(result?.status).toBe(200);
  }, 60_000);
});

describe.skipIf(!hasBrowser)('captureSet guards', () => {
  /** @type {import('node:http').Server[]} */
  const servers = [];
  let site = '';
  let foreign = '';
  /** @type {string[]} */
  const foreignHits = [];

  /**
   * @param {import('node:http').RequestListener} handler
   * @returns {Promise<string>}
   */
  const listen = async (handler) => {
    const server = createServer(handler);
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  };

  beforeAll(async () => {
    foreign = await listen((req, res) => {
      foreignHits.push(req.url ?? '');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>foreign</h1>');
    });
    site = await listen((req, res) => {
      const path = (req.url ?? '').split('?')[0];
      if (path === '/hop') {
        res.writeHead(302, { location: '/hop-2' });
        res.end();
        return;
      }
      if (path === '/hop-2') {
        res.writeHead(302, { location: `${foreign}/landed` });
        res.end();
        return;
      }
      if (path === '/fatal') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<p>Fatal error: Allowed memory size exhausted</p>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<h1>${path}</h1>`);
    });
  });

  afterAll(() =>
    Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    ),
  );

  const options = {
    viewport: { width: 400, height: 300 },
    fullPage: false,
    hide: [],
    concurrency: 1,
    cacheBust: true,
  };

  it('blocks a redirect chain that leaves the site and marks the page broken', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const [ok, hop, fatal] = await captureSet(
      { baseUrl: site, paths: ['/', '/hop', '/fatal'], environments: {} },
      out,
      options,
    );
    expect(ok?.broken).toBeUndefined();
    expect(hop?.broken).toBe(`navigation outside the URL set: ${foreign}/landed`);
    expect(foreignHits).toEqual([]);
    expect(fatal?.broken).toBe('error page: Fatal error:');
  }, 60_000);

  it('follows redirects to origins listed in allowedOrigins', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-visual-'));
    const [hop] = await captureSet(
      { baseUrl: site, paths: ['/hop'], environments: {}, allowedOrigins: [foreign] },
      out,
      options,
    );
    expect(hop?.broken).toBeUndefined();
    expect(foreignHits.length).toBeGreaterThan(0);
  }, 60_000);
});
