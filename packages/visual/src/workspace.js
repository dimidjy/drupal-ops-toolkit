import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import { eachPage, guardedContext } from './capture.js';
import { diffImages } from './compare.js';

/**
 * The visual testing workspace behind the dashboard: paste a list of URLs,
 * screenshot them "before" a change, again "after" it, then page through the
 * differences. Unlike URL sets it needs no config, and credentials are only
 * kept in memory for the run.
 */

/** Hosts whose requests are dropped when trackers are blocked: they slow pages down and add noise. */
export const TRACKER_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'doubleclick.net',
  'facebook.net',
  'connect.facebook.net',
  'hotjar.com',
  'clarity.ms',
  'matomo.cloud',
  'cookiebot.com',
  'onetrust.com',
  'linkedin.com/px',
  'snap.licdn.com',
];

/**
 * @typedef {'before' | 'after'} Phase
 *
 * @typedef {object} WorkspaceCaptureOptions
 * @property {{ width: number, height: number }} viewport
 * @property {boolean} fullPage
 * @property {string[]} [hide] CSS selectors hidden before the screenshot.
 * @property {number} [settleMs] Extra wait after the page is idle (animations, lazy images).
 * @property {{ username: string, password: string }} [credentials] Basic auth.
 * @property {{ name: string, value: string, domain?: string, path?: string }[]} [cookies]
 * @property {boolean} [blockTrackers]
 * @property {number} [concurrency] Pages captured at the same time (browser tabs).
 *
 * @typedef {object} CapturedPage
 * @property {string} url
 * @property {string} file
 * @property {number} status HTTP status, 0 when the page failed.
 * @property {string} [error]
 * @property {string} [blocked] Why a navigation off the listed sites was stopped.
 * @property {string} [fatal] Drupal or PHP error text found on the page.
 * @property {string} [broken] Set when the page did not load correctly.
 * @property {string} capturedAt
 *
 * @typedef {object} WorkspaceDiff
 * @property {string} url
 * @property {string} file
 * @property {'different' | 'error'} status
 * @property {number} [diffPercent]
 * @property {boolean} [sizeMismatch]
 * @property {{ width: number, height: number }} [dimensionDifference]
 * @property {string} [message]
 * @property {string} [beforeCapturedAt]
 * @property {string} [afterCapturedAt]
 */

/**
 * File name for a full URL: "https://shop.ddev.site/user/login?x=1" → "shop.ddev.site_user-login_x-1.png".
 *
 * @param {string} url
 */
export function urlFileName(url) {
  const { host, pathname, search } = new URL(url);
  const slug = `${pathname}${search}`
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
  return `${host.replace(/[^a-zA-Z0-9.-]/g, '-')}_${slug || 'home'}.png`.slice(0, 200);
}

/**
 * Parses pasted text: one URL per line, blank lines and # comments ignored.
 *
 * @param {string} text
 */
export function parseUrlList(text) {
  const urls = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const url = new URL(line);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Not an http(s) URL: ${line}`);
    }
    urls.push(url.href);
  }
  return [...new Set(urls)];
}

/**
 * Screenshots a list of URLs into `outDir`, several tabs at a time, with
 * optional basic auth, cookies, tracker blocking and a settle delay.
 * Results come back in the order of `urls`; `onPage` fires as pages finish.
 *
 * Navigations can only reach the origins in the list, and basic auth is only
 * sent to the origin of the page being captured: each origin gets its own
 * browser context with its credentials bound to it.
 *
 * @param {string[]} urls
 * @param {string} outDir
 * @param {WorkspaceCaptureOptions} options
 * @param {{ fileName?: (url: string, index: number) => string,
 *   onPage?: (page: CapturedPage, index: number) => void, signal?: AbortSignal }} [hooks]
 * @returns {Promise<CapturedPage[]>}
 */
export async function captureUrls(urls, outDir, options, hooks = {}) {
  const { fileName = urlFileName, onPage, signal } = hooks;
  await mkdir(outDir, { recursive: true });
  const allowed = new Set(urls.map((url) => new URL(url).origin));
  /** @type {Map<string, number[]>} */
  const byOrigin = new Map();
  for (const [index, url] of urls.entries()) {
    const origin = new URL(url).origin;
    byOrigin.set(origin, [...(byOrigin.get(origin) ?? []), index]);
  }
  /** @param {string} url */
  const isTracker = (url) => TRACKER_HOSTS.some((host) => url.includes(host));

  const browser = await chromium.launch();
  /** @type {CapturedPage[]} */
  const pages = [];
  try {
    for (const [origin, indexes] of byOrigin) {
      if (signal?.aborted) break;
      const { context, shoot } = await guardedContext(browser, {
        viewport: options.viewport,
        allowed,
        ...(options.credentials ? { credentials: { ...options.credentials, origin } } : {}),
        ...(options.blockTrackers ? { blockRequest: isTracker } : {}),
      });
      if (options.cookies?.length) {
        await context.addCookies(
          options.cookies.map(({ name, value, domain, path }) =>
            domain ? { name, value, domain, path: path ?? '/' } : { name, value, url: origin },
          ),
        );
      }
      await eachPage(
        context,
        indexes,
        options.concurrency ?? 1,
        async (page, index) => {
          const url = /** @type {string} */ (urls[index]);
          const file = fileName(url, index);
          const outcome = await shoot(page, url, join(outDir, file), {
            fullPage: options.fullPage,
            ...(options.hide ? { hide: options.hide } : {}),
            ...(options.settleMs ? { settleMs: options.settleMs } : {}),
          });
          const result = { url, file, ...outcome, capturedAt: new Date().toISOString() };
          pages[index] = result;
          onPage?.(result, index);
          return outcome;
        },
        signal,
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
  return pages.filter(Boolean);
}

export class VisualWorkspace {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
  }

  /** @param {Phase | 'diff'} phase */
  phaseDir(phase) {
    return join(this.dir, phase);
  }

  get manifestFile() {
    return join(this.dir, 'manifest.json');
  }

  /** @returns {Promise<Record<Phase, Record<string, CapturedPage>>>} */
  async manifest() {
    try {
      return JSON.parse(await readFile(this.manifestFile, 'utf8'));
    } catch {
      return { before: {}, after: {} };
    }
  }

  /**
   * Screenshots the URLs for one phase. Reports each page as it finishes.
   *
   * @param {Phase} phase
   * @param {string[]} urls
   * @param {WorkspaceCaptureOptions} options
   * @param {(page: CapturedPage, index: number) => void} [onPage]
   * @param {AbortSignal} [signal]
   * @returns {Promise<CapturedPage[]>}
   */
  async capture(phase, urls, options, onPage, signal) {
    const pages = await captureUrls(urls, this.phaseDir(phase), options, {
      ...(onPage ? { onPage } : {}),
      ...(signal ? { signal } : {}),
    });
    const manifest = await this.manifest();
    for (const page of pages) manifest[phase][page.file] = page;
    await writeFile(this.manifestFile, JSON.stringify(manifest, null, 2));
    return pages;
  }

  /** How many screenshots each phase has. */
  async counts() {
    /** @param {string} dir */
    const pngs = async (dir) =>
      existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.png')).length : 0;
    return {
      before: await pngs(this.phaseDir('before')),
      after: await pngs(this.phaseDir('after')),
    };
  }

  /**
   * Compares "before" and "after" screenshots of the same URL and returns only
   * the ones that differ, a page at a time, like a long list you scroll through.
   *
   * @param {object} options
   * @param {number} options.start Index in the list of pairs to resume from.
   * @param {number} options.limit Most differences to return.
   * @param {number} options.threshold pixelmatch per-pixel tolerance.
   * @param {number} options.maxDiffRatio Share of pixels that may differ before a page counts.
   * @param {number} [options.timeBudgetMs] Stop early so one request never blocks for long.
   */
  async compare({ start, limit, threshold, maxDiffRatio, timeBudgetMs = 20_000 }) {
    const manifest = await this.manifest();
    const before = Object.keys(manifest.before).filter((f) =>
      existsSync(join(this.phaseDir('before'), f)),
    );
    const afterSet = new Set(
      Object.keys(manifest.after).filter((f) => existsSync(join(this.phaseDir('after'), f))),
    );
    const pairs = before.filter((file) => afterSet.has(file)).sort();
    await mkdir(this.phaseDir('diff'), { recursive: true });

    /** @type {WorkspaceDiff[]} */
    const results = [];
    let identicalSkipped = 0;
    let index = Math.max(0, start);
    const startedAt = Date.now();
    for (; index < pairs.length && results.length < limit; index++) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      const file = /** @type {string} */ (pairs[index]);
      const beforeInfo = manifest.before[file];
      const afterInfo = manifest.after[file];
      const url = afterInfo?.url ?? beforeInfo?.url ?? file;
      if (afterInfo?.broken) {
        results.push({ url, file, status: 'error', message: `After: ${afterInfo.broken}` });
        continue;
      }
      try {
        const [a, b] = await Promise.all([
          readFile(join(this.phaseDir('before'), file)),
          readFile(join(this.phaseDir('after'), file)),
        ]);
        if (a.equals(b)) {
          identicalSkipped++;
          continue;
        }
        const { ratio, diff } = diffImages(a, b, { threshold });
        const sizeA = PNG.sync.read(a);
        const sizeB = PNG.sync.read(b);
        const sizeMismatch = sizeA.width !== sizeB.width || sizeA.height !== sizeB.height;
        if (!sizeMismatch && ratio <= maxDiffRatio) {
          identicalSkipped++;
          continue;
        }
        await writeFile(join(this.phaseDir('diff'), file), PNG.sync.write(diff));
        results.push({
          url,
          file,
          status: 'different',
          diffPercent: Number((ratio * 100).toFixed(2)),
          sizeMismatch,
          dimensionDifference: {
            width: sizeB.width - sizeA.width,
            height: sizeB.height - sizeA.height,
          },
          ...(beforeInfo ? { beforeCapturedAt: beforeInfo.capturedAt } : {}),
          ...(afterInfo ? { afterCapturedAt: afterInfo.capturedAt } : {}),
        });
      } catch (error) {
        results.push({
          url,
          file,
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return {
      start,
      nextStart: index,
      total: pairs.length,
      identicalSkipped,
      done: index >= pairs.length,
      onlyBefore: before.length - pairs.length,
      onlyAfter: afterSet.size - pairs.length,
      broken: Object.values(manifest.after).flatMap((page) =>
        page.broken ? [{ url: page.url, reason: page.broken }] : [],
      ),
      results,
    };
  }

  /** Removes every screenshot, diff and the manifest. */
  async clear() {
    await rm(this.dir, { recursive: true, force: true });
  }
}
