import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VisualWorkspace, captureUrls, parseUrlList, urlFileName } from '../src/workspace.js';

describe.skipIf(!existsSync(chromium.executablePath()))('captureUrls guards', () => {
  /** @type {import('node:http').Server[]} */
  const servers = [];
  /** @type {{ server: string, url: string, auth: boolean }[]} */
  const hits = [];
  let siteA = '';
  let siteB = '';
  let outside = '';

  /**
   * @param {string} label
   * @param {(path: string) => { status: number, location?: string, body?: string }} respond
   */
  const listen = async (label, respond) => {
    const server = createServer((req, res) => {
      hits.push({ server: label, url: req.url ?? '', auth: Boolean(req.headers.authorization) });
      if (!req.headers.authorization) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="site"' });
        res.end();
        return;
      }
      const { status, location, body } = respond((req.url ?? '').split('?')[0] ?? '');
      res.writeHead(status, { 'content-type': 'text/html', ...(location ? { location } : {}) });
      res.end(body ?? `<h1>${label}</h1>`);
    });
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    return `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  };

  beforeAll(async () => {
    outside = await listen('outside', () => ({ status: 200 }));
    siteB = await listen('b', () => ({ status: 200 }));
    siteA = await listen('a', (path) =>
      path === '/leave' ? { status: 302, location: `${outside}/landed` } : { status: 200 },
    );
  });

  afterAll(() =>
    Promise.all(
      servers.map((server) => new Promise((resolve) => server.close(() => resolve(undefined)))),
    ),
  );

  it('blocks redirects off the list and sends credentials only to each page’s own site', async () => {
    const out = await mkdtemp(join(tmpdir(), 'dops-urls-'));
    const pages = await captureUrls([`${siteA}/`, `${siteA}/leave`, `${siteB}/`], out, {
      viewport: { width: 400, height: 300 },
      fullPage: false,
      credentials: { username: 'qa', password: 's3cret' },
      concurrency: 1,
    });
    expect(pages.map((page) => [page.status, page.broken ?? null])).toEqual([
      [200, null],
      [0, `navigation outside the URL set: ${outside}/landed`],
      [200, null],
    ]);
    expect(hits.filter((hit) => hit.server === 'outside')).toEqual([]);
    expect(hits.some((hit) => hit.server === 'b' && hit.auth)).toBe(true);
  }, 60_000);
});

/**
 * @param {number} width
 * @param {number} height
 * @param {number} [square] black square in the corner
 */
function png(width, height, square = 0) {
  const image = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) {
    const x = i % width;
    const y = Math.floor(i / width);
    const v = x < square && y < square ? 0 : 255;
    image.data.set([v, v, v, 255], i * 4);
  }
  return PNG.sync.write(image);
}

describe('URL lists', () => {
  it('parses pasted text and names files after host and path', () => {
    expect(
      parseUrlList('https://a.test/\n\n# skip\nhttps://a.test/x?y=1\nhttps://a.test/'),
    ).toEqual(['https://a.test/', 'https://a.test/x?y=1']);
    expect(() => parseUrlList('ftp://a.test/')).toThrow(/http/);
    expect(urlFileName('https://shop.ddev.site/user/login?x=1')).toBe(
      'shop.ddev.site_user-login-x-1.png',
    );
    expect(urlFileName('https://shop.ddev.site/')).toBe('shop.ddev.site_home.png');
  });
});

describe('VisualWorkspace.compare', () => {
  it('returns only differences, a page at a time', async () => {
    const workspace = new VisualWorkspace(await mkdtemp(join(tmpdir(), 'dops-ws-visual-')));
    /** @type {Record<'before' | 'after', Record<string, object>>} */
    const manifest = { before: {}, after: {} };
    await mkdir(workspace.phaseDir('before'), { recursive: true });
    await mkdir(workspace.phaseDir('after'), { recursive: true });
    const pages = [
      ['a.png', png(10, 10), png(10, 10)],
      ['b.png', png(10, 10), png(10, 10, 5)],
      ['c.png', png(10, 10), png(10, 12)],
      ['d.png', png(10, 10), png(10, 10, 4)],
    ];
    for (const [file, before, after] of pages) {
      await writeFile(
        join(workspace.phaseDir('before'), String(file)),
        /** @type {Buffer} */ (before),
      );
      await writeFile(
        join(workspace.phaseDir('after'), String(file)),
        /** @type {Buffer} */ (after),
      );
      const info = {
        url: `https://a.test/${file}`,
        file,
        status: 200,
        capturedAt: '2025-12-22T10:00:00Z',
      };
      manifest.before[String(file)] = info;
      manifest.after[String(file)] = info;
    }
    await writeFile(workspace.manifestFile, JSON.stringify(manifest));

    const options = { threshold: 0.1, maxDiffRatio: 0.001 };
    const first = await workspace.compare({ start: 0, limit: 1, ...options });
    expect(first.results.map((r) => r.file)).toEqual(['b.png']);
    expect(first.identicalSkipped).toBe(1);
    expect(first.results[0]?.diffPercent).toBe(25);
    expect(first.done).toBe(false);

    const rest = await workspace.compare({ start: first.nextStart, limit: 10, ...options });
    expect(rest.results.map((r) => [r.file, r.sizeMismatch])).toEqual([
      ['c.png', true],
      ['d.png', false],
    ]);
    expect(rest.done).toBe(true);
    expect(existsSync(join(workspace.phaseDir('diff'), 'd.png'))).toBe(true);
  });
});

describe.skipIf(!existsSync(chromium.executablePath()))('VisualWorkspace.capture', () => {
  /** @type {import('node:http').Server} */
  let server;
  let base = '';
  /** @type {string[]} */
  const seen = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push(`${req.url} ${req.headers.cookie ?? ''} ${req.headers.authorization ?? ''}`);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<h1>Page</h1><script src="https://www.googletagmanager.com/gtm.js"></script>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => new Promise((resolve) => server.close(() => resolve(undefined))));

  it('captures pasted URLs with cookies and basic auth and records them', async () => {
    const workspace = new VisualWorkspace(await mkdtemp(join(tmpdir(), 'dops-ws-visual-')));
    /** @type {string[]} */
    const progress = [];
    const pages = await workspace.capture(
      'before',
      [`${base}/`, `${base}/about`],
      {
        viewport: { width: 400, height: 300 },
        fullPage: false,
        settleMs: 10,
        blockTrackers: true,
        credentials: { username: 'qa', password: 'secret' },
        cookies: [{ name: 'SESSabc', value: 'xyz' }],
        concurrency: 2,
      },
      (page) => progress.push(page.url),
    );
    expect(pages.map((p) => p.status)).toEqual([200, 200]);
    expect(progress).toHaveLength(2);
    expect(seen.some((line) => line.includes('SESSabc=xyz'))).toBe(true);
    expect((await workspace.counts()).before).toBe(2);
    expect(Object.keys((await workspace.manifest()).before)).toHaveLength(2);
  }, 60_000);
});
