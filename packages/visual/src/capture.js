import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

/** @import { VisualConfig, UrlSet } from '@dops/core' */

const MAX_REDIRECT_HOPS = 10;

const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Page text that means Drupal or PHP failed, even with a 200 status. */
const FATAL_PATTERNS = [
  /The website encountered an unexpected error/i,
  /\bFatal error:/i,
  /\bUncaught (?:Exception|Error|TypeError)\b/i,
];

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
 * Throws unless the label is safe to use as a folder name (no "/", no "..").
 *
 * @param {string} label
 */
export function assertSafeLabel(label) {
  if (!SAFE_LABEL.test(label)) {
    throw new Error(`Bad capture label "${label}": use letters, digits, ".", "_" or "-"`);
  }
}

/**
 * Absolute URL of a path on the set's site; throws when the path points elsewhere.
 *
 * @param {string} path
 * @param {string} baseUrl
 */
export function pageUrl(path, baseUrl) {
  const url = new URL(path, baseUrl);
  const origin = new URL(baseUrl).origin;
  if (url.origin !== origin) {
    throw new Error(`Path "${path}" leaves the site (${url.origin} is not ${origin})`);
  }
  return url;
}

/**
 * Origins a capture may navigate to: the set's base URL plus `allowedOrigins`.
 *
 * @param {UrlSet} urlSet
 */
export function allowedOriginsOf(urlSet) {
  return new Set(
    [urlSet.baseUrl, ...(urlSet.allowedOrigins ?? [])].map((url) => new URL(url).origin),
  );
}

/**
 * Adds a unique `_dops` query parameter so caches in front of the site (Varnish,
 * CDN) serve a fresh page.
 *
 * @param {URL} url
 * @param {string} token
 */
export function cacheBusted(url, token) {
  const out = new URL(url);
  out.searchParams.set('_dops', token);
  return out.href;
}

/**
 * Removes the `_dops` cache-busting parameter from a URL or a message quoting one.
 *
 * @param {string} text
 */
export function stripCacheBust(text) {
  return text.replace(/([?&])_dops=[^&\s:]*&?/g, '$1').replace(/[?&](?=\s|$)/g, '');
}

/**
 * Follows a navigation's redirect chain one hop at a time, before the browser
 * requests anything, and stops at the first hop that leaves the allowed origins.
 * A hop that cannot be checked blocks the navigation.
 *
 * @template {{ status(): number, headers(): Record<string, string> }} R
 * @param {{ fetch(options: { url: string, maxRedirects: number, timeout: number }): Promise<R> }} route
 * @param {string} startUrl
 * @param {Set<string>} allowedOrigins
 * @param {number} timeout
 * @returns {Promise<{ blocked: string } | { response: R }>}
 */
export async function verifyNavigation(route, startUrl, allowedOrigins, timeout) {
  let url = startUrl;
  /** @type {R | undefined} */
  let first;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop++) {
    let origin = '';
    try {
      origin = new URL(url).origin;
    } catch {
      return { blocked: `invalid URL ${url}` };
    }
    if (!allowedOrigins.has(origin)) return { blocked: `navigation outside the URL set: ${url}` };
    /** @type {R} */
    let response;
    try {
      response = await route.fetch({ url, maxRedirects: 0, timeout });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { blocked: `could not check ${url}: ${message.split('\n')[0]}` };
    }
    first ??= response;
    const location = response.headers()['location'];
    const status = response.status();
    if (status < 300 || status >= 400 || !location) return { response: first };
    try {
      url = new URL(location, url).href;
    } catch {
      return { blocked: `bad redirect location ${location}` };
    }
  }
  return { blocked: `too many redirects from ${startUrl}` };
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
 * Why a captured page cannot count as a pass, or undefined when it loaded fine.
 *
 * @param {Pick<CaptureResult, 'status' | 'error' | 'blocked' | 'fatal'>} result
 */
export function brokenReason(result) {
  if (result.blocked) return result.blocked;
  if (result.error) return result.error.split('\n')[0];
  if (result.status === 0) return 'no response';
  if (result.status >= 400) return `HTTP ${result.status}`;
  if (result.fatal) return `error page: ${result.fatal}`;
  return undefined;
}

/**
 * @typedef {object} CaptureResult
 * @property {string} path
 * @property {string} file
 * @property {number} status HTTP status of the page (0 when it failed to load).
 * @property {string} [error]
 * @property {string} [blocked] Why the navigation was stopped before it left the URL set.
 * @property {string} [fatal] Error text found on the page.
 * @property {string} [broken] Set when the page did not load correctly; see {@link brokenReason}.
 */

/**
 * @typedef {Pick<VisualConfig, 'viewport' | 'fullPage' | 'hide' | 'concurrency'> & Partial<Pick<VisualConfig, 'cacheBust'>>} CaptureOptions
 */

/**
 * Opens one URL and screenshots it, unless it ended up on another site.
 *
 * @param {import('playwright').Page} page
 * @param {URL} url
 * @param {string} file
 * @param {CaptureOptions & { token: string, allowed: Set<string> }} options
 * @returns {Promise<{ status: number, fatal?: string, offOrigin?: string }>}
 */
async function screenshotPage(page, url, file, options) {
  const target = options.cacheBust ? cacheBusted(url, options.token) : url.href;
  const response = await page.goto(target, { waitUntil: 'networkidle', timeout: 45_000 });
  const status = response?.status() ?? 0;
  const finalOrigin = new URL(page.url()).origin;
  if (!options.allowed.has(finalOrigin)) {
    return { status, offOrigin: `redirected off the URL set to ${finalOrigin}` };
  }
  const html = await page.content();
  const fatal = FATAL_PATTERNS.map((pattern) => html.match(pattern)?.[0]).find(Boolean);
  if (options.hide.length) {
    await page.addStyleTag({
      content: `${options.hide.join(', ')} { visibility: hidden !important; }`,
    });
  }
  await page.screenshot({ path: file, fullPage: options.fullPage, animations: 'disabled' });
  return fatal ? { status, fatal } : { status };
}

/**
 * Screenshots every path of a URL set into `outDir`, several tabs at a time.
 * Results come back in the order of `urlSet.paths`; `onPage` fires as pages finish.
 *
 * Navigations may only reach the set's own origin (and `allowedOrigins`): every
 * redirect hop is checked before the browser requests it, so a misconfigured
 * environment cannot send the capture, or its credentials, to another site.
 *
 * @param {UrlSet} urlSet
 * @param {string} outDir
 * @param {CaptureOptions} options
 * @param {(result: CaptureResult) => void} [onPage]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<CaptureResult[]>}
 */
export async function captureSet(urlSet, outDir, options, onPage, env = process.env) {
  const credentials = httpCredentials(urlSet, env);
  const allowed = allowedOriginsOf(urlSet);
  const token = `${Date.now()}`;
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

    /** @type {WeakMap<import('playwright').Page, string>} */
    const blockedBy = new WeakMap();
    await context.route('**/*', async (route) => {
      try {
        const request = route.request();
        if (!request.isNavigationRequest()) return await route.continue();
        /** @type {import('playwright').Frame | null} */
        let frame = null;
        try {
          frame = request.frame();
        } catch {
          frame = null;
        }
        if (frame?.parentFrame()) return await route.continue();
        const block = async (/** @type {string} */ reason) => {
          const page = frame?.page();
          if (page && !blockedBy.has(page)) blockedBy.set(page, stripCacheBust(reason));
          await route.abort('blockedbyclient');
        };
        if (request.method() !== 'GET') {
          return await block(`${request.method()} navigation to ${request.url()}`);
        }
        const verdict = await verifyNavigation(route, request.url(), allowed, 30_000);
        if ('blocked' in verdict) return await block(verdict.blocked);
        return await route.fulfill({ response: verdict.response });
      } catch {
        await route.abort('blockedbyclient').catch(() => undefined);
      }
    });

    /** @type {CaptureResult[]} */
    const results = new Array(urlSet.paths.length);
    let next = 0;

    const worker = async () => {
      let page = await context.newPage();
      while (next < urlSet.paths.length) {
        const index = next++;
        const path = /** @type {string} */ (urlSet.paths[index]);
        const file = join(outDir, screenshotName(path));
        blockedBy.delete(page);
        /** @type {CaptureResult} */
        let result;
        try {
          const url = pageUrl(path, urlSet.baseUrl);
          const shot = await screenshotPage(page, url, file, {
            ...options,
            token,
            allowed,
          });
          result = { path, file, status: shot.status };
          if (shot.fatal) result.fatal = shot.fatal;
          const blocked = blockedBy.get(page) ?? shot.offOrigin;
          if (blocked) result.blocked = blocked;
        } catch (error) {
          const blocked = blockedBy.get(page);
          const message = error instanceof Error ? error.message : String(error);
          result = blocked
            ? { path, file, status: 0, blocked }
            : { path, file, status: 0, error: stripCacheBust(message) };
        }
        const broken = brokenReason(result);
        if (broken) result.broken = broken;
        results[index] = result;
        onPage?.(result);
        if (result.blocked || result.error) {
          await page.close();
          page = await context.newPage();
        }
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
