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
 * @typedef {object} CaptureResult
 * @property {string} path
 * @property {string} file
 * @property {number} status HTTP status of the page (0 when it failed to load).
 * @property {string} [error]
 */

/**
 * Screenshots every path of a URL set into `outDir`.
 *
 * @param {UrlSet} urlSet
 * @param {string} outDir
 * @param {Pick<VisualConfig, 'viewport' | 'fullPage' | 'hide'>} options
 * @param {(result: CaptureResult) => void} [onPage]
 * @returns {Promise<CaptureResult[]>}
 */
export async function captureSet(urlSet, outDir, options, onPage) {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: options.viewport,
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    /** @type {CaptureResult[]} */
    const results = [];
    for (const path of urlSet.paths) {
      const file = join(outDir, screenshotName(path));
      /** @type {CaptureResult} */
      let result;
      try {
        const response = await page.goto(new URL(path, urlSet.baseUrl).href, {
          waitUntil: 'networkidle',
          timeout: 45_000,
        });
        if (options.hide.length) {
          await page.addStyleTag({
            content: `${options.hide.join(', ')} { visibility: hidden !important; }`,
          });
        }
        await page.screenshot({ path: file, fullPage: options.fullPage, animations: 'disabled' });
        result = { path, file, status: response?.status() ?? 0 };
      } catch (error) {
        result = {
          path,
          file,
          status: 0,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      results.push(result);
      onPage?.(result);
    }
    return results;
  } finally {
    await browser.close();
  }
}
