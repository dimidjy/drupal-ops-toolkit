import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { finished } from 'node:stream/promises';

/** @import { CommandExecutor } from '../ssh/executor.js' */

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

/**
 * Default file name, e.g. `.dops/db/prod-web1-fr-20260907-2114.sql.gz`.
 *
 * @param {string} dir
 * @param {string} target
 * @param {string} [site]
 * @param {Date} [now]
 */
export function dumpFileName(dir, target, site, now = new Date()) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `${dir}/${[target, site, stamp].filter(Boolean).join('-')}.sql.gz`;
}

/** @param {string} file */
async function startsWithGzipMagic(file) {
  const handle = await open(file, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return bytesRead === 2 && buffer.equals(GZIP_MAGIC);
  } finally {
    await handle.close();
  }
}

/**
 * Streams a database dump from a target into a local file. The dump is written
 * to `<file>.part` and only renamed once the remote command succeeded, so a
 * failed pull never leaves a truncated dump behind.
 *
 * @param {object} options
 * @param {CommandExecutor} options.executor
 * @param {string} options.command  Remote command writing the gzipped dump to stdout.
 * @param {string} options.cwd
 * @param {string} options.file
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<{ file: string, bytes: number, durationMs: number }>}
 */
export async function pullDatabase({ executor, command, cwd, file, timeoutMs, signal }) {
  const started = Date.now();
  const partial = `${file}.part`;
  await mkdir(dirname(file), { recursive: true });
  const out = createWriteStream(partial);
  let stderr = '';
  try {
    const result = await executor.exec(command, {
      cwd,
      stdout: out,
      onStderr: (chunk) => {
        stderr = (stderr + chunk).slice(-2000);
      },
      ...(timeoutMs ? { timeoutMs } : {}),
      ...(signal ? { signal } : {}),
    });
    out.end();
    await finished(out);
    if (result.code !== 0) {
      throw new Error(
        `Dump command exited with ${result.code}${stderr ? `:\n${stderr.trim()}` : ''}`,
      );
    }
    const { size } = await stat(partial);
    if (!size) throw new Error('Dump command produced no output');
    if (file.endsWith('.gz') && !(await startsWithGzipMagic(partial))) {
      throw new Error('Dump is not gzip data; does the command end with "| gzip -c"?');
    }
    await rename(partial, file);
    return { file, bytes: size, durationMs: Date.now() - started };
  } catch (error) {
    out.destroy();
    await rm(partial, { force: true });
    throw error;
  }
}
