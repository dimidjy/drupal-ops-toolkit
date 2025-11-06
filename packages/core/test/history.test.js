import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunHistory } from '../src/history/store.js';
import { PipelineRunner } from '../src/pipeline/runner.js';

const record = (id, pipeline) => ({
  id,
  pipeline,
  targets: ['web1'],
  status: 'ok',
  startedAt: '2025-11-06T10:00:00.000Z',
  finishedAt: '2025-11-06T10:01:00.000Z',
  steps: [],
});

const tempHistory = async () => new RunHistory(await mkdtemp(join(tmpdir(), 'dops-')));

describe('RunHistory', () => {
  it('lists runs newest first and filters by pipeline', async () => {
    const history = await tempHistory();
    expect(await history.list()).toEqual([]);
    await history.append(record('a', 'deploy'));
    await history.append(record('b', 'cache-clear'));
    await history.append(record('c', 'deploy'));
    expect((await history.list()).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect((await history.list({ pipeline: 'deploy', limit: 1 })).map((r) => r.id)).toEqual(['c']);
    expect((await history.get('b'))?.pipeline).toBe('cache-clear');
  });

  it('records a run and its output', async () => {
    const history = await tempHistory();
    const runner = new PipelineRunner();
    const stop = await history.record(runner);
    const result = await runner.run({
      pipelineName: 'cache-clear',
      pipeline: {
        targets: ['web1'],
        steps: [{ name: 'Cache', run: 'drush cr', continueOnError: false, timeoutSeconds: 30 }],
      },
      targets: { web1: { host: 'h', port: 22, user: 'u', agent: true, path: '.' } },
      connect: async () => ({
        exec: async (_command, options) => {
          options?.onStdout?.('[success] Cache rebuild complete.\n');
          return { code: 0 };
        },
        close: async () => {},
      }),
    });
    await stop();
    expect((await history.list())[0]?.id).toBe(result.id);
    expect(await history.readLog(result.id)).toContain('Cache rebuild complete');
  });

  it('rejects path traversal in run ids', () => {
    expect(() => new RunHistory('/tmp/x').logPath('../etc/passwd')).toThrow(/Invalid run id/);
  });
});
