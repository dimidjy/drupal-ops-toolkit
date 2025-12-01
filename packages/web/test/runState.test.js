import { describe, expect, it } from 'vitest';
import { initialRunView, runReducer } from '../src/runState.js';

const reduce = (events) => events.reduce(runReducer, initialRunView);

describe('runReducer', () => {
  it('builds step views from a live event stream', () => {
    const view = reduce([
      { type: 'run-start', pipeline: 'deploy', targets: ['web1', 'web2'] },
      { type: 'step-start', target: 'web1', index: 0, name: 'Pull', command: 'git pull' },
      { type: 'output', target: 'web1', index: 0, stream: 'stdout', text: 'Already ' },
      { type: 'output', target: 'web1', index: 0, stream: 'stdout', text: 'up to date.\n' },
      {
        type: 'step-end',
        target: 'web1',
        index: 0,
        step: { name: 'Pull', command: 'git pull', status: 'failed', code: 1, durationMs: 800 },
      },
      {
        type: 'step-end',
        target: 'web2',
        index: 0,
        step: { name: 'Pull', command: 'git pull', status: 'skipped', durationMs: 0 },
      },
      { type: 'run-end', record: { status: 'failed' } },
    ]);
    expect(view.status).toBe('failed');
    expect(view.steps).toHaveLength(2);
    expect(view.steps[0]).toMatchObject({
      status: 'failed',
      code: 1,
      output: 'Already up to date.\n',
    });
    expect(view.steps[1]).toMatchObject({ target: 'web2', status: 'skipped' });
  });

  it('shows stored steps for a run that already finished', () => {
    const view = reduce([
      {
        type: 'run-end',
        record: {
          pipeline: 'cache-clear',
          targets: ['web1'],
          status: 'ok',
          steps: [{ target: 'web1', name: 'Cache', command: 'drush cr', status: 'ok', code: 0 }],
        },
      },
    ]);
    expect(view).toMatchObject({ pipeline: 'cache-clear', status: 'ok' });
    expect(view.steps[0]?.name).toBe('Cache');
  });

  it('marks unknown runs', () => {
    expect(reduce([{ type: 'unknown-run' }]).status).toBe('unknown');
  });
});
