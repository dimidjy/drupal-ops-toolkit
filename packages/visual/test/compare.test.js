import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { compareDirs, diffImages } from '../src/compare.js';

/**
 * Solid white image with an optional black square in the top-left corner.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [square]
 */
function image(width, height, square = 0) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const value = x < square && y < square ? 0 : 255;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = value;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe('diffImages', () => {
  it('finds no difference between identical images', () => {
    expect(diffImages(image(20, 20), image(20, 20), { threshold: 0.1 }).diffPixels).toBe(0);
  });

  it('counts changed pixels', () => {
    const result = diffImages(image(10, 10), image(10, 10, 5), { threshold: 0.1 });
    expect(result.diffPixels).toBe(25);
    expect(result.ratio).toBe(0.25);
  });

  it('treats extra height as changed', () => {
    const result = diffImages(image(10, 10), image(10, 20), { threshold: 0.1 });
    expect(result.diff.height).toBe(20);
    expect(result.ratio).toBe(0.5);
  });
});

describe('compareDirs', () => {
  it('classifies pages and writes diff images', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dops-compare-'));
    const beforeDir = join(root, 'before');
    const afterDir = join(root, 'after');
    const diffDir = join(root, 'diff');
    await mkdir(beforeDir);
    await mkdir(afterDir);
    await writeFile(join(beforeDir, 'home.png'), image(10, 10));
    await writeFile(join(afterDir, 'home.png'), image(10, 10));
    await writeFile(join(beforeDir, 'cart.png'), image(10, 10));
    await writeFile(join(afterDir, 'cart.png'), image(10, 10, 4));
    await writeFile(join(beforeDir, 'old.png'), image(10, 10));
    await writeFile(join(afterDir, 'new.png'), image(10, 10));

    const results = await compareDirs(
      { beforeDir, afterDir, diffDir },
      { threshold: 0.1, maxDiffRatio: 0.01 },
    );

    expect(results.map((r) => [r.name, r.status])).toEqual([
      ['cart.png', 'changed'],
      ['home.png', 'same'],
      ['new.png', 'added'],
      ['old.png', 'removed'],
    ]);
    expect(existsSync(join(diffDir, 'cart.png'))).toBe(true);
  });
});
