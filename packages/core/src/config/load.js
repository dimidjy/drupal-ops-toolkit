import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { parse } from 'yaml';
import { ZodError } from 'zod';
import { configSchema } from './schema.js';

export const DEFAULT_CONFIG_FILE = 'dops.config.yml';

export class ConfigError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [issues]
   */
  constructor(message, issues = []) {
    super(issues.length ? `${message}\n  - ${issues.join('\n  - ')}` : message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Replaces `${VAR}` with values from the environment so that hosts or users can
 * differ per machine without editing the file. Missing variables are collected.
 *
 * @param {unknown} value
 * @param {NodeJS.ProcessEnv} env
 * @param {Set<string>} missing
 * @returns {unknown}
 */
export function interpolateEnv(value, env, missing) {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, /** @type {string} */ key) => {
      const resolved = env[key];
      if (resolved === undefined) {
        missing.add(key);
        return '';
      }
      return resolved;
    });
  }
  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env, missing));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, env, missing)]),
    );
  }
  return value;
}

/** @param {string} path */
export function expandHome(path) {
  return path === '~' || path.startsWith('~/') ? homedir() + path.slice(1) : path;
}

/**
 * @param {string} source YAML text
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {import('./schema.js').Config}
 */
export function parseConfig(source, env = process.env) {
  const raw = parse(source) ?? {};
  /** @type {Set<string>} */
  const missing = new Set();
  const interpolated = interpolateEnv(raw, env, missing);
  if (missing.size) {
    throw new ConfigError('Missing environment variables', [...missing].sort());
  }
  try {
    return configSchema.parse(interpolated);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ConfigError(
        'Invalid configuration',
        error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      );
    }
    throw error;
  }
}

/**
 * @param {string} [file]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<import('./schema.js').Config>}
 */
export async function loadConfig(file = DEFAULT_CONFIG_FILE, env = process.env) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    throw new ConfigError(`Cannot read config file ${file}`);
  }
  return parseConfig(source, env);
}
