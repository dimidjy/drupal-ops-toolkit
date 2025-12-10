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

/** Placeholders every run provides from the target itself. */
export const BUILTIN_PARAMS = ['target', 'environment', 'path', 'site'];

/**
 * Placeholders a pipeline needs from sites or run-time values.
 *
 * @param {{ steps: { run: string }[] }} pipeline
 */
export function pipelineParams(pipeline) {
  const names = pipeline.steps.flatMap((step) => placeholdersIn(step.run));
  return [...new Set(names)].filter((name) => !BUILTIN_PARAMS.includes(name));
}

/**
 * Parses `key=value` pairs from the command line.
 *
 * @param {string[]} pairs
 * @returns {Record<string, string>}
 */
export function parseParamPairs(pairs) {
  /** @type {Record<string, string>} */
  const values = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at < 1) throw new Error(`Expected key=value, got "${pair}"`);
    values[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return values;
}

/**
 * Checks run-time values: no line breaks, since they end up in shell commands.
 *
 * @param {Record<string, string>} values
 */
export function assertParamValues(values) {
  for (const [key, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`Parameter "${key}" must be a single line`);
  }
}

/**
 * Placeholders of a pipeline that nothing fills in.
 *
 * @param {{ steps: { run: string }[] }} pipeline
 * @param {Params[]} sources Defaults, site parameters, run-time values.
 */
export function missingParams(pipeline, ...sources) {
  return pipelineParams(pipeline).filter((name) => !sources.some((source) => name in source));
}
