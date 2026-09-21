import { describe, expect, it } from 'vitest';
import { notificationText, notifyRun, shouldNotify } from '../src/notify.js';

/** @import { UiTestRun } from '../src/runner.js' */

/**
 * @param {'passed' | 'failed' | 'error'} status
 * @returns {UiTestRun}
 */
const run = (status) => ({
  id: '1',
  suite: 'smoke',
  status,
  startedAt: '',
  finishedAt: '',
  stats: { passed: 4, failed: status === 'failed' ? 1 : 0, flaky: 0, skipped: 0, durationMs: 1 },
  failures:
    status === 'failed'
      ? [{ title: 'cart › add product', file: 'cart.spec.js', line: 3, error: 'Timeout' }]
      : [],
  reportDir: '/runs/1/report',
  ...(status === 'error' ? { error: 'baseURL unreachable' } : {}),
});

describe('shouldNotify', () => {
  it('reports failures and recoveries by default', () => {
    expect(shouldNotify(run('failed'), run('passed'), 'failures')).toBe(true);
    expect(shouldNotify(run('passed'), run('failed'), 'failures')).toBe(true);
    expect(shouldNotify(run('passed'), run('passed'), 'failures')).toBe(false);
    expect(shouldNotify(run('passed'), undefined, 'always')).toBe(true);
  });
});

describe('notificationText', () => {
  it('lists failing tests', () => {
    expect(notificationText(run('failed'), undefined)).toBe(
      ':x: UI tests *smoke*: 1 of 5 failed\n• cart › add product — Timeout\nReport: /runs/1/report/index.html',
    );
  });

  it('says when a suite recovered', () => {
    expect(notificationText(run('passed'), run('failed'))).toContain('pass again');
  });
});

describe('notifyRun', () => {
  it('posts the text to the webhook from the environment', async () => {
    /** @type {[string, RequestInit][]} */
    const calls = [];
    /** @type {typeof fetch} */
    const fakeFetch = async (url, init) => {
      calls.push([String(url), init ?? {}]);
      return new Response(null, { status: 200 });
    };
    const sent = await notifyRun(
      run('error'),
      undefined,
      { webhookEnv: 'HOOK', when: 'failures' },
      {
        env: { HOOK: 'https://hooks.example.com/x' },
        fetch: fakeFetch,
      },
    );
    expect(sent).toBe(true);
    expect(calls[0]?.[0]).toBe('https://hooks.example.com/x');
    expect(JSON.parse(String(calls[0]?.[1].body)).text).toContain('could not run');
  });

  it('does nothing without a notify config or for a quiet pass', async () => {
    expect(await notifyRun(run('failed'), undefined, undefined)).toBe(false);
    expect(
      await notifyRun(run('passed'), undefined, { webhookEnv: 'HOOK', when: 'failures' }),
    ).toBe(false);
  });
});
