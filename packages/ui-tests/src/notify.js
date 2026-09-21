/**
 * @import { UiNotify } from '@dops/core'
 * @import { UiTestRun } from './runner.js'
 */

/**
 * @param {UiTestRun} run
 * @param {UiTestRun | undefined} previous  The suite's run before this one.
 * @param {'failures' | 'always'} when
 */
export function shouldNotify(run, previous, when) {
  if (when === 'always' || run.status !== 'passed') return true;
  return Boolean(previous && previous.status !== 'passed');
}

/**
 * @param {UiTestRun} run
 * @param {UiTestRun | undefined} previous
 */
export function notificationText(run, previous) {
  if (run.status === 'error')
    return `:warning: UI tests *${run.suite}* could not run: ${run.error}`;
  const stats = run.stats;
  const total = stats ? stats.passed + stats.failed : 0;
  if (run.status === 'passed') {
    const recovered = previous && previous.status !== 'passed' ? ' again' : '';
    return `:white_check_mark: UI tests *${run.suite}* pass${recovered} (${total} tests)`;
  }
  const lines = [`:x: UI tests *${run.suite}*: ${stats?.failed} of ${total} failed`];
  for (const failure of run.failures.slice(0, 10)) {
    lines.push(`• ${failure.title} — ${failure.error}`);
  }
  if (run.failures.length > 10) lines.push(`…and ${run.failures.length - 10} more`);
  lines.push(`Report: ${run.reportDir}/index.html`);
  return lines.join('\n');
}

/**
 * Sends the run to the configured webhook when it is worth a message.
 *
 * @param {UiTestRun} run
 * @param {UiTestRun | undefined} previous
 * @param {UiNotify} notify
 * @param {{ env?: NodeJS.ProcessEnv, fetch?: typeof fetch }} [deps]
 * @returns {Promise<boolean>} whether a message was sent
 */
export async function notifyRun(
  run,
  previous,
  notify,
  { env = process.env, fetch = globalThis.fetch } = {},
) {
  if (!notify || !shouldNotify(run, previous, notify.when)) return false;
  const url = env[notify.webhookEnv];
  if (!url) throw new Error(`${notify.webhookEnv} is not set`);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: notificationText(run, previous) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Webhook returned ${response.status}`);
  return true;
}
