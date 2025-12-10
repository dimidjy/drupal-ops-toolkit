import { useState } from 'react';

/** @import { ParamInfo } from '../api.js' */

/**
 * @typedef {object} ParamContext
 * @property {ParamInfo[]} definitions
 * @property {Record<string, string[]>} siteParams Placeholders each site fills in.
 */

// `{name}` but not `${VAR}`; the same rule as the server.
const PLACEHOLDER = /(?<!\$)\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
const BUILTIN = ['target', 'environment', 'path', 'site'];

/** @param {string} text */
export function placeholdersIn(text) {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => String(m[1])))].filter(
    (name) => !BUILTIN.includes(name),
  );
}

/**
 * Works out which placeholders need a site and which need a value typed in.
 *
 * @param {string[]} needed
 * @param {string} site
 * @param {ParamContext} context
 */
export function splitParams(needed, site, context) {
  const defined = new Set(context.definitions.map((d) => d.name));
  const fromSites = new Set(Object.values(context.siteParams).flat());
  const fromSite = new Set(site ? (context.siteParams[site] ?? []) : []);
  return {
    // Site-only values (like {alias}): pick a site instead of typing them.
    needsSite: needed.some((name) => !defined.has(name) && fromSites.has(name)),
    fields: needed.filter(
      (name) => !fromSite.has(name) && (defined.has(name) || !fromSites.has(name)),
    ),
  };
}

/**
 * Inputs for run-time parameters, prefilled with their defaults.
 *
 * @param {ParamContext} context
 */
export function useParamValues(context) {
  const [values, setValues] = useState(/** @type {Record<string, string>} */ ({}));
  /** @param {string} name */
  const valueOf = (name) =>
    values[name] ?? context.definitions.find((d) => d.name === name)?.default ?? '';
  return {
    valueOf,
    /** @param {string} name @param {string} value */
    set: (name, value) => setValues((current) => ({ ...current, [name]: value })),
    /** @param {string[]} names */
    collect: (names) => Object.fromEntries(names.map((name) => [name, valueOf(name)])),
  };
}

/**
 * @param {{ names: string[], context: ParamContext,
 *   values: ReturnType<typeof useParamValues> }} props
 */
export function ParamFields({ names, context, values }) {
  if (!names.length) return null;
  return (
    <div className="param-fields">
      {names.map((name) => {
        const definition = context.definitions.find((d) => d.name === name);
        return (
          <label key={name}>
            <span>
              <code>{`{${name}}`}</code>
              {definition?.description && (
                <span className="muted"> · {definition.description}</span>
              )}
            </span>
            <input
              value={values.valueOf(name)}
              onChange={(e) => values.set(name, e.target.value)}
              placeholder={name}
            />
          </label>
        );
      })}
    </div>
  );
}
