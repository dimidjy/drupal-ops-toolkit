import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TestHistory } from '../src/history.js';

/**
 * @param {string} id
 * @param {string} suite
 * @returns {import('../src/runner.js').UiTestRun}
 */
const run = (id, suite) => ({
  id,
  suite,
  status: 'passed',
  startedAt: '2026-09-14T08:00:00Z',
  finishedAt: '2026-09-14T08:01:00Z',
  failures: [],
  reportDir: `/runs/${id}/report`,
});

describe('TestHistory', () => {
  it('lists newest first, filters by suite and finds by id', async () => {
    const history = new TestHistory(await mkdtemp(join(tmpdir(), 'dops-ui-history-')));
    expect(await history.list()).toEqual([]);
    await history.append(run('1', 'smoke'));
    await history.append(run('2', 'checkout'));
    await history.append(run('3', 'smoke'));

    expect((await history.list()).map((r) => r.id)).toEqual(['3', '2', '1']);
    expect((await history.list({ suite: 'smoke', limit: 1 })).map((r) => r.id)).toEqual(['3']);
    expect((await history.get('2'))?.suite).toBe('checkout');
  });
});
