import { afterEach, describe, expect, it } from 'vitest';
import { startScheduler } from '../src/scheduler.js';

/** @type {(() => Promise<void>) | undefined} */
let stop;
afterEach(async () => {
  await stop?.();
  stop = undefined;
});

describe('startScheduler', () => {
  it('rejects invalid cron expressions', () => {
    expect(() =>
      startScheduler([{ suite: 'smoke', cron: 'every morning' }], { run: async () => {} }),
    ).toThrow(/Invalid cron expression: "every morning"/);
  });

  it('runs the suite and knows the next run', async () => {
    /** @type {string[]} */
    const runs = [];
    const scheduler = startScheduler([{ suite: 'smoke', cron: '0 7 * * 1-5' }], {
      run: async (schedule) => {
        runs.push(schedule.suite);
      },
    });
    stop = scheduler.stop;
    const [first] = scheduler.scheduled;
    expect(first?.task.getNextRun()?.getHours()).toBe(7);
    await first?.task.execute();
    expect(runs).toEqual(['smoke']);
  });

  it('skips a trigger while the same suite is still running', async () => {
    /** @type {string[]} */
    const skipped = [];
    /** @type {() => void} */
    let finish = () => {};
    const scheduler = startScheduler(
      [
        { suite: 'smoke', cron: '0 7 * * *' },
        { suite: 'smoke', cron: '0 12 * * *' },
      ],
      {
        run: () => new Promise((resolve) => (finish = () => resolve(undefined))),
        onSkip: (suite) => skipped.push(suite),
      },
    );
    stop = scheduler.stop;
    const [morning, noon] = scheduler.scheduled;
    const first = morning?.task.execute();
    await noon?.task.execute();
    finish();
    await first;
    expect(skipped).toEqual(['smoke']);
  });
});
