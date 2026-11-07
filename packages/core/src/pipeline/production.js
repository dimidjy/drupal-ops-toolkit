/** @import { Target } from '../config/schema.js' */

/**
 * Raised when a run would touch production targets without an explicit confirmation.
 */
export class ProductionConfirmationError extends Error {
  /** @param {string[]} targets */
  constructor(targets) {
    super(`Production targets need confirmation: ${targets.join(', ')}`);
    this.name = 'ProductionConfirmationError';
    this.targets = targets;
    this.statusCode = 428;
  }
}

/**
 * Names of the production targets among `targets`.
 *
 * @param {Record<string, Target>} targets
 * @returns {string[]}
 */
export function productionTargets(targets) {
  return Object.entries(targets)
    .filter(([, target]) => target.production)
    .map(([name]) => name);
}

/**
 * Throws unless the run touches no production target or was confirmed.
 *
 * @param {Record<string, Target>} targets
 * @param {boolean | undefined} confirmed
 */
export function assertProductionConfirmed(targets, confirmed) {
  const production = productionTargets(targets);
  if (production.length && !confirmed) throw new ProductionConfirmationError(production);
}
