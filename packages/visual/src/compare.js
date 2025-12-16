import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

/**
 * @typedef {'same' | 'changed' | 'added' | 'removed'} DiffStatus
 *
 * @typedef {object} PageDiff
 * @property {string} name Screenshot file name.
 * @property {DiffStatus} status
 * @property {number} diffPixels
 * @property {number} ratio Share of differing pixels (0..1).
 * @property {string} [diffFile]
 */

/**
 * Copies `png` onto a transparent canvas of the given size, so screenshots of
 * different heights can still be compared (the extra area counts as changed).
 *
 * @param {PNG} png
 * @param {number} width
 * @param {number} height
 */
function padTo(png, width, height) {
  if (png.width === width && png.height === height) return png;
  const out = new PNG({ width, height });
  PNG.bitblt(png, out, 0, 0, png.width, png.height, 0, 0);
  return out;
}

/**
 * Compares two PNG buffers.
 *
 * @param {Buffer} before
 * @param {Buffer} after
 * @param {{ threshold: number }} options
 * @returns {{ diffPixels: number, ratio: number, diff: PNG }}
 */
export function diffImages(before, after, { threshold }) {
  const a = PNG.sync.read(before);
  const b = PNG.sync.read(after);
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(
    padTo(a, width, height).data,
    padTo(b, width, height).data,
    diff.data,
    width,
    height,
    { threshold, alpha: 0.3 },
  );
  return { diffPixels, ratio: diffPixels / (width * height), diff };
}

/** @param {string} dir */
async function pngFiles(dir) {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((file) => file.endsWith('.png'));
}

/**
 * Compares every screenshot in `beforeDir` with its namesake in `afterDir`
 * and writes diff images to `diffDir`.
 *
 * @param {{ beforeDir: string, afterDir: string, diffDir: string }} dirs
 * @param {{ threshold: number, maxDiffRatio: number }} options
 * @returns {Promise<PageDiff[]>}
 */
export async function compareDirs({ beforeDir, afterDir, diffDir }, options) {
  const before = new Set(await pngFiles(beforeDir));
  const after = new Set(await pngFiles(afterDir));
  await mkdir(diffDir, { recursive: true });

  /** @type {PageDiff[]} */
  const results = [];
  for (const name of [...new Set([...before, ...after])].sort()) {
    if (!after.has(name)) {
      results.push({ name, status: 'removed', diffPixels: 0, ratio: 1 });
      continue;
    }
    if (!before.has(name)) {
      results.push({ name, status: 'added', diffPixels: 0, ratio: 1 });
      continue;
    }
    const { diffPixels, ratio, diff } = diffImages(
      await readFile(join(beforeDir, name)),
      await readFile(join(afterDir, name)),
      options,
    );
    const diffFile = join(diffDir, name);
    await writeFile(diffFile, PNG.sync.write(diff));
    results.push({
      name,
      status: ratio > options.maxDiffRatio ? 'changed' : 'same',
      diffPixels,
      ratio,
      diffFile,
    });
  }
  return results;
}
