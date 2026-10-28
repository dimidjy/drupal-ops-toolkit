import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@dops/core';
import { ScheduleStore, pickRunOptions } from '../src/schedules.js';

const { uiTests } = parseConfig(`
uiTests:
  suites:
    smoke:
      testDir: tests/smoke
      baseUrl: https://shop.ddev.site
      environments: { prod: 'https://www.example.com' }
`);

describe('ScheduleStore', () => {
  it('adds, toggles and removes schedules', async () => {
    const store = new ScheduleStore(join(await mkdtemp(join(tmpdir(), 'dops-sched-')), 's.json'));
    const added = await store.add(uiTests, {
      name: 'Morning prod check',
      suite: 'smoke',
      cron: '30 7 * * 1-5',
      environment: 'prod',
      browser: 'mobile',
    });
    expect(added.enabled).toBe(true);
    expect((await store.update(added.id, { enabled: false }))?.enabled).toBe(false);
    expect(await store.list()).toHaveLength(1);
    expect(pickRunOptions(added)).toEqual({ environment: 'prod', browser: 'mobile' });
    expect(await store.remove(added.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it('rejects unknown suites, environments and bad cron', async () => {
    const store = new ScheduleStore(join(await mkdtemp(join(tmpdir(), 'dops-sched-')), 's.json'));
    await expect(store.add(uiTests, { suite: 'nope', cron: '* * * * *' })).rejects.toThrow(/suite/);
    await expect(store.add(uiTests, { suite: 'smoke', cron: 'daily' })).rejects.toThrow(/cron/);
    await expect(
      store.add(uiTests, { suite: 'smoke', cron: '* * * * *', environment: 'qa' }),
    ).rejects.toThrow(/environment/);
  });
});
