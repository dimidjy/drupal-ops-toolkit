/** @import { TargetInfo } from './api.js' */

/**
 * Production servers among the chosen targets.
 *
 * @param {TargetInfo[]} targets
 * @param {string[]} chosen
 */
export function productionNames(targets, chosen) {
  return targets.filter((t) => t.production && chosen.includes(t.name)).map((t) => t.name);
}

/**
 * Asks before anything runs on production. Returns the extra request fields to
 * send, or null when the user cancelled.
 *
 * @param {string} what e.g. `pipeline "deploy"`
 * @param {string[]} production
 * @param {(message: string) => boolean} [ask]
 * @returns {{ confirmProduction?: true } | null}
 */
export function confirmProduction(what, production, ask = (message) => window.confirm(message)) {
  if (!production.length) return {};
  const ok = ask(`Run ${what} on PRODUCTION?\n\n${production.join('\n')}`);
  return ok ? { confirmProduction: true } : null;
}
