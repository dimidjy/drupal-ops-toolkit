import { existsSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { dumpFileName, pullDatabase } from '../src/db/pull.js';

/** @import { CommandExecutor, ExecOptions } from '../src/ssh/executor.js' */

/**
 * @param {Buffer} stdout
 * @param {number} [code]
 * @param {string} [stderr]
 * @returns {CommandExecutor & { calls: [string, ExecOptions][] }}
 */
function fakeExecutor(stdout, code = 0, stderr = '') {
  /** @type {[string, ExecOptions][]} */
  const calls = [];
  return {
    calls,
    async exec(command, options = {}) {
      calls.push([command, options]);
      options.stdout?.write(stdout);
      if (stderr) options.onStderr?.(stderr);
      return { code };
    },
    async close() {},
  };
}

describe('dumpFileName', () => {
  it('includes target, site and time', () => {
    const name = dumpFileName('.dops/db', 'prod', 'fr', new Date(2026, 8, 7, 21, 4));
    expect(name).toBe('.dops/db/prod-fr-20260907-2104.sql.gz');
  });
});

describe('pullDatabase', () => {
  const sql = gzipSync('CREATE TABLE node (nid int);\n');

  it('writes the dump and reports its size', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-db-'));
    const executor = fakeExecutor(sql);
    const result = await pullDatabase({
      executor,
      command: 'drush sql-dump | gzip -c',
      cwd: '/var/www/site',
      file: join(dir, 'dump.sql.gz'),
    });
    expect(result.bytes).toBe(sql.length);
    expect(executor.calls[0]?.[1].cwd).toBe('/var/www/site');
    expect(await readdir(dir)).toEqual(['dump.sql.gz']);
  });

  it('removes the partial file when the command fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-db-'));
    const file = join(dir, 'dump.sql.gz');
    const executor = fakeExecutor(Buffer.from('partial'), 1, 'Access denied for user');
    await expect(pullDatabase({ executor, command: 'x', cwd: '.', file })).rejects.toThrow(
      /exited with 1:\nAccess denied/,
    );
    expect(await readdir(dir)).toEqual([]);
  });

  it('rejects output that is not gzip', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-db-'));
    const file = join(dir, 'dump.sql.gz');
    const executor = fakeExecutor(Buffer.from('CREATE TABLE'));
    await expect(pullDatabase({ executor, command: 'x', cwd: '.', file })).rejects.toThrow(
      /not gzip/,
    );
    expect(existsSync(file)).toBe(false);
  });
});
