import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { diffImages } from './compare.js';
import { captureUrls } from './workspace.js';

/**
 * @import { CapturedPage, WorkspaceCaptureOptions } from './workspace.js'
 */

/**
 * @typedef {Pick<WorkspaceCaptureOptions, 'credentials' | 'cookies'>} Side
 *
 * @typedef {object} PairResult
 * @property {number} index
 * @property {string} urlA
 * @property {string} urlB
 * @property {'identical' | 'different' | 'error'} status
 * @property {number} [diffPercent]
 * @property {number} [diffPixels]
 * @property {{ width: number, height: number }} [sizeA]
 * @property {{ width: number, height: number }} [sizeB]
 * @property {boolean} [sizeMismatch]
 * @property {string} [fileA]
 * @property {string} [fileB]
 * @property {string} [diffFile]
 * @property {string} [message]
 */

/** @param {number} index */
const pad = (index) => String(index + 1).padStart(3, '0');

/**
 * Screenshots list A and list B (paired line by line, e.g. production and
 * staging, or an old and a new URL scheme) and diffs every pair.
 *
 * @param {object} options
 * @param {string[]} options.urlsA
 * @param {string[]} options.urlsB
 * @param {string} options.outDir
 * @param {number} options.threshold
 * @param {WorkspaceCaptureOptions} options.capture Shared settings (viewport, delay, parallel…).
 * @param {Side} [options.sideA]
 * @param {Side} [options.sideB]
 * @param {(side: 'A' | 'B', page: CapturedPage) => void} [options.onPage]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PairResult[]>}
 */
export async function comparePairs({
  urlsA,
  urlsB,
  outDir,
  threshold,
  capture,
  sideA = {},
  sideB = {},
  onPage,
  signal,
}) {
  if (!urlsA.length || urlsA.length !== urlsB.length) {
    throw new Error('Both lists need the same number of URLs (paired line by line)');
  }
  await mkdir(outDir, { recursive: true });
  /** @param {'A' | 'B'} side @param {string[]} urls @param {Side} extra */
  const shoot = (side, urls, extra) =>
    captureUrls(
      urls,
      outDir,
      { ...capture, ...extra },
      {
        fileName: (_url, index) => `${side.toLowerCase()}-${pad(index)}.png`,
        onPage: (page) => onPage?.(side, page),
        ...(signal ? { signal } : {}),
      },
    );
  const pagesA = await shoot('A', urlsA, sideA);
  const pagesB = signal?.aborted ? [] : await shoot('B', urlsB, sideB);

  /** @type {PairResult[]} */
  const results = [];
  for (const [index, urlA] of urlsA.entries()) {
    const urlB = /** @type {string} */ (urlsB[index]);
    const a = pagesA[index];
    const b = pagesB[index];
    if (!a || !b || a.error || b.error) {
      results.push({
        index,
        urlA,
        urlB,
        status: 'error',
        message: a?.error ?? b?.error ?? 'Not captured',
      });
      continue;
    }
    const [bufferA, bufferB] = await Promise.all([
      readFile(join(outDir, a.file)),
      readFile(join(outDir, b.file)),
    ]);
    const { diffPixels, ratio, diff } = diffImages(bufferA, bufferB, { threshold });
    const imageA = PNG.sync.read(bufferA);
    const imageB = PNG.sync.read(bufferB);
    const sizeMismatch = imageA.width !== imageB.width || imageA.height !== imageB.height;
    const diffFile = `diff-${pad(index)}.png`;
    await writeFile(join(outDir, diffFile), PNG.sync.write(diff));
    results.push({
      index,
      urlA,
      urlB,
      status: diffPixels === 0 && !sizeMismatch ? 'identical' : 'different',
      diffPercent: Number((ratio * 100).toFixed(2)),
      diffPixels,
      sizeA: { width: imageA.width, height: imageA.height },
      sizeB: { width: imageB.width, height: imageB.height },
      sizeMismatch,
      fileA: a.file,
      fileB: b.file,
      diffFile,
    });
  }
  await writeFile(
    join(outDir, 'result.json'),
    JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2),
  );
  return results;
}
