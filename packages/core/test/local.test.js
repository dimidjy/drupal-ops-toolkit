import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CommandTimeoutError, LocalExecutor, parseConfig, sshConnector } from '../src/index.js';

describe('LocalExecutor', () => {
  it('runs in the given folder and streams both outputs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-local-'));
    let out = '';
    let err = '';
    const result = await new LocalExecutor().exec(
      'pwd; echo oops >&2; echo hi > note.txt; exit 3',
      {
        cwd: dir,
        onStdout: (text) => (out += text),
        onStderr: (text) => (err += text),
      },
    );
    expect(result.code).toBe(3);
    expect(out.trim()).toBe(dir);
    expect(err.trim()).toBe('oops');
    expect(await readFile(join(dir, 'note.txt'), 'utf8')).toBe('hi\n');
  });

  it('times out long commands', async () => {
    await expect(new LocalExecutor().exec('sleep 5', { timeoutMs: 100 })).rejects.toBeInstanceOf(
      CommandTimeoutError,
    );
  });

  it('stops when the run is cancelled', async () => {
    const controller = new AbortController();
    const running = new LocalExecutor().exec('sleep 5', { signal: controller.signal });
    controller.abort();
    expect((await running).signal).toBe('SIGTERM');
  });
});

describe('local targets', () => {
  it('need no SSH settings and get a local shell', async () => {
    const config = parseConfig(`
targets:
  laptop: { local: true, path: /tmp, environment: dev }
pipelines:
  cr: { targets: [laptop], steps: [{ name: Cache, run: 'ddev drush cr' }] }
`);
    const target = config.targets.laptop;
    expect(target).toMatchObject({ local: true, path: '/tmp' });
    const executor = await sshConnector(config)('laptop', /** @type {any} */ (target));
    expect(executor).toBeInstanceOf(LocalExecutor);
  });
});
