import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

/** @import { VisualConfig, UrlSet } from '@dops/core' */

/**
 * File name for a path: "/" → "home.png", "/product/2" → "product-2.png".
 *
 * @param {string} path
 */
export function screenshotName(path) {
  const slug = path
    .replace(/[?#].*$/, '')
    .replace(/^\/+|\/+$/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase();
  return `${slug || 'home'}.png`;
}

/**
 * The URL set pointed at one of its named environments (or as is without one).
 *
 * @param {UrlSet} urlSet
 * @param {string} [environment]
 * @returns {UrlSet}
 */
export function forEnvironment(urlSet, environment) {
  if (!environment) return urlSet;
  const baseUrl = urlSet.environments[environment];
  if (!baseUrl) {
    const known = Object.keys(urlSet.environments).join(', ') || 'none defined';
    throw new Error(`Unknown environment "${environment}" (${known})`);
  }
  return { ...urlSet, baseUrl };
}

/**
 * Resolves basic auth credentials of a URL set from the environment.
 *
 * @param {UrlSet} urlSet
 * @param {NodeJS.ProcessEnv} env
 * @returns {{ username: string, password: string } | undefined}
 */
export function httpCredentials(urlSet, env) {
  if (!urlSet.httpAuth) return undefined;
  const { usernameEnv, passwordEnv } = urlSet.httpAuth;
  const username = env[usernameEnv];
  const password = env[passwordEnv];
  if (!username || !password) {
    throw new Error(`Basic auth needs ${usernameEnv} and ${passwordEnv} to be set`);
  }
  return { username, password };
}

/**
 * @typedef {object} CaptureResult
 * @property {string} path
 * @property {string} file
 * @property {number} status HTTP status of the page (0 when it failed to load).
 * @property {string} [error]
 */

/**
 * Opens one URL and screenshots it.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {string} file
 * @param {Pick<VisualConfig, 'fullPage' | 'hide'>} options
 * @returns {Promise<number>} HTTP status
 */
async function screenshotPage(page, url, file, options) {
  const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });
  if (options.hide.length) {
    await page.addStyleTag({
      content: `${options.hide.join(', ')} { visibility: hidden !important; }`,
    });
  }
  await page.screenshot({ path: file, fullPage: options.fullPage, animations: 'disabled' });
  return response?.status() ?? 0;
}

/**
 * Screenshots every path of a URL set into `outDir`, several tabs at a time.
 * Results come back in the order of `urlSet.paths`; `onPage` fires as pages finish.
 *
 * @param {UrlSet} urlSet
 * @param {string} outDir
 * @param {Pick<VisualConfig, 'viewport' | 'fullPage' | 'hide' | 'concurrency'>} options
 * @param {(result: CaptureResult) => void} [onPage]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<CaptureResult[]>}
 */
export async function captureSet(urlSet, outDir, options, onPage, env = process.env) {
  const credentials = httpCredentials(urlSet, env);
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: options.viewport,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
      ...(credentials
        ? { httpCredentials: { ...credentials, origin: new URL(urlSet.baseUrl).origin } }
        : {}),
    });
    /** @type {CaptureResult[]} */
    const results = new Array(urlSet.paths.length);
    let next = 0;

    const worker = async () => {
      const page = await context.newPage();
      while (next < urlSet.paths.length) {
        const index = next++;
        const path = /** @type {string} */ (urlSet.paths[index]);
        const file = join(outDir, screenshotName(path));
        /** @type {CaptureResult} */
        let result;
        try {
          const url = new URL(path, urlSet.baseUrl).href;
          result = { path, file, status: await screenshotPage(page, url, file, options) };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result = { path, file, status: 0, error: message };
        }
        results[index] = result;
        onPage?.(result);
      }
      await page.close();
    };

    const workers = Math.max(1, Math.min(options.concurrency, urlSet.paths.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
  } finally {
    await browser.close();
  }
}
