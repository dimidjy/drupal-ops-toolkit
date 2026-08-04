import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comparePairs } from '../src/pairs.js';

const capture = { viewport: { width: 400, height: 300 }, fullPage: false, concurrency: 2 };

describe('comparePairs', () => {
  it('needs lists of the same length', async () => {
    await expect(
      comparePairs({
        urlsA: ['https://a.test/'],
        urlsB: [],
        outDir: tmpdir(),
        threshold: 0.1,
        capture,
      }),
    ).rejects.toThrow(/same number/);
  });
});

describe.skipIf(!existsSync(chromium.executablePath()))('comparePairs with a browser', () => {
  /** @type {import('node:http').Server} */
  let server;
  let base = '';

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (
        req.url?.startsWith('/b/') &&
        req.headers.authorization !== `Basic ${Buffer.from('qa:pw').toString('base64')}`
      ) {
        res.writeHead(401, { 'www-authenticate': 'Basic' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' });
      const title = req.url === '/b/news' ? 'News (new design)' : 'News';
      res.end(`<h1 style="font:40px sans-serif">${title}</h1>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(() => new Promise((resolve) => server.close(() => resolve(undefined))));

  it('captures both sides with their own auth and diffs each pair', async () => {
    const outDir = await mkdtemp(join(tmpdir(), 'dops-pairs-'));
    /** @type {string[]} */
    const progress = [];
    const results = await comparePairs({
      urlsA: [`${base}/a/home`, `${base}/a/news`],
      urlsB: [`${base}/b/home`, `${base}/b/news`],
      outDir,
      threshold: 0.1,
      capture,
      sideB: { credentials: { username: 'qa', password: 'pw' } },
      onPage: (side, page) => progress.push(`${side} ${page.status}`),
    });
    expect(results.map((r) => r.status)).toEqual(['identical', 'different']);
    expect(results[1]?.diffPercent).toBeGreaterThan(0);
    expect(progress.sort()).toEqual(['A 200', 'A 200', 'B 200', 'B 200']);
    const saved = JSON.parse(await readFile(join(outDir, 'result.json'), 'utf8'));
    expect(saved.results).toHaveLength(2);
  }, 60_000);
});
