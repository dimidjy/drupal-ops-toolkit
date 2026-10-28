/**
 * The schedule shapes the dashboard offers, turned into cron and back.
 *
 * @typedef {{ mode: 'daily' | 'weekdays', time: string } | { mode: 'every', minutes: number }
 *   | { mode: 'cron', expression: string }} When
 */

/** @param {When} when */
export function toCron(when) {
  if (when.mode === 'cron') return when.expression.trim();
  if (when.mode === 'every')
    return `*/${Math.min(Math.max(Math.trunc(when.minutes), 5), 59)} * * * *`;
  const [hours = '0', minutes = '0'] = when.time.split(':');
  return `${Number(minutes)} ${Number(hours)} * * ${when.mode === 'weekdays' ? '1-5' : '*'}`;
}

/** @param {string} expression */
export function describeCron(expression) {
  const every = /^\*\/(\d+) \* \* \* \*$/.exec(expression);
  if (every) return `every ${every[1]} minutes`;
  const daily = /^(\d+) (\d+) \* \* (\*|1-5)$/.exec(expression);
  if (daily) {
    const time = `${daily[2]?.padStart(2, '0')}:${daily[1]?.padStart(2, '0')}`;
    return daily[3] === '1-5' ? `weekdays at ${time}` : `daily at ${time}`;
  }
  return expression;
}
