/** @typedef {Record<string, string | number | boolean>} Params */

export class PlaceholderError extends Error {
  /** @param {string[]} missing */
  constructor(missing) {
    super(`Unknown placeholder${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`);
    this.name = 'PlaceholderError';
    this.missing = missing;
  }
}

// `{name}` but not shell expansions such as `${HOME}`.
const PLACEHOLDER = /(?<!\$)\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

/**
 * @param {string} template
 * @returns {string[]}
 */
export function placeholdersIn(template) {
  return [...new Set([...template.matchAll(PLACEHOLDER)].map((match) => String(match[1])))];
}

/**
 * Fills `{name}` placeholders; unknown names are an error so typos never reach a server.
 *
 * @param {string} template
 * @param {Params} params
 */
export function renderTemplate(template, params) {
  const missing = placeholdersIn(template).filter((key) => !(key in params));
  if (missing.length) {
    throw new PlaceholderError(missing);
  }
  return template.replace(PLACEHOLDER, (_, /** @type {string} */ key) => String(params[key]));
}
