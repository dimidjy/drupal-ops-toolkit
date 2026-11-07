import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { parse } from 'yaml';
import { ZodError } from 'zod';
import { configSchema } from './schema.js';

export const DEFAULT_CONFIG_FILE = 'dops.config.yml';

/** Folder next to the config file with one pipeline per YAML file. */
export const PIPELINES_DIR = 'pipelines';

/** Folder next to the config file with one environment (its targets) per YAML file. */
export const ENVIRONMENTS_DIR = 'environments';

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
  return validateConfig(parse(source) ?? {}, env);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, any>}
 */
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Reads every `*.yml` / `*.yaml` file of a folder, sorted by name. A missing
 * folder gives an empty list.
 *
 * @param {string} dir
 * @returns {Promise<{ name: string, file: string, data: Record<string, any> }[]>}
 */
async function readYamlDir(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
  const files = entries.filter((entry) => ['.yml', '.yaml'].includes(extname(entry))).sort();
  return Promise.all(
    files.map(async (entry) => {
      const file = join(dir, entry);
      let data;
      try {
        data = parse(await readFile(file, 'utf8')) ?? {};
      } catch (error) {
        const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
        throw new ConfigError(`Cannot parse ${file}`, [message ?? '']);
      }
      if (!isRecord(data)) throw new ConfigError(`${file} must contain a YAML mapping`);
      return { name: basename(entry, extname(entry)), file, data };
    }),
  );
}

/**
 * Adds the files of `environments/` and `pipelines/` to a raw config.
 *
 * - `environments/<env>.yml` holds `targets` (and optionally `bastions`) of one
 *   environment. Each target gets `environment: <env>` unless it sets its own,
 *   and `production: true` at the top of the file marks all of them.
 * - `pipelines/<name>.yml` holds one pipeline. Instead of `targets` it may name
 *   an `environment`, meaning every target of that environment.
 *
 * Names must be unique across the main file and the folders.
 *
 * @param {Record<string, any>} raw
 * @param {string} baseDir
 * @returns {Promise<Record<string, any>>}
 */
export async function mergeConfigDirs(raw, baseDir) {
  const config = {
    ...raw,
    bastions: { ...(isRecord(raw.bastions) ? raw.bastions : {}) },
    targets: { ...(isRecord(raw.targets) ? raw.targets : {}) },
    pipelines: { ...(isRecord(raw.pipelines) ? raw.pipelines : {}) },
  };
  /** @type {string[]} */
  const issues = [];

  for (const { name, file, data } of await readYamlDir(join(baseDir, ENVIRONMENTS_DIR))) {
    for (const [key, bastion] of Object.entries(isRecord(data.bastions) ? data.bastions : {})) {
      if (key in config.bastions) issues.push(`${file}: bastion "${key}" is already defined`);
      else config.bastions[key] = bastion;
    }
    for (const [key, target] of Object.entries(isRecord(data.targets) ? data.targets : {})) {
      if (key in config.targets) {
        issues.push(`${file}: target "${key}" is already defined`);
        continue;
      }
      config.targets[key] = {
        environment: name,
        ...(data.production === true ? { production: true } : {}),
        ...(isRecord(target) ? target : {}),
      };
    }
  }

  for (const { name, file, data } of await readYamlDir(join(baseDir, PIPELINES_DIR))) {
    if (name in config.pipelines) {
      issues.push(`${file}: pipeline "${name}" is already defined`);
      continue;
    }
    const { environment, ...pipeline } = data;
    if (environment !== undefined && pipeline.targets === undefined) {
      pipeline.targets = Object.entries(config.targets)
        .filter(([, target]) => isRecord(target) && target.environment === environment)
        .map(([key]) => key);
      if (!pipeline.targets.length) {
        issues.push(`${file}: environment "${environment}" has no targets`);
        continue;
      }
    }
    config.pipelines[name] = pipeline;
  }

  if (issues.length) throw new ConfigError('Conflicting configuration files', issues);
  return config;
}

/**
 * Interpolates `${VAR}` and validates a raw config against the schema.
 *
 * @param {unknown} raw
 * @param {NodeJS.ProcessEnv} env
 * @returns {import('./schema.js').Config}
 */
function validateConfig(raw, env) {
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
 * Loads the config file plus the `environments/` and `pipelines/` folders next to it.
 *
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
  const raw = parse(source) ?? {};
  if (!isRecord(raw)) throw new ConfigError(`${file} must contain a YAML mapping`);
  return validateConfig(await mergeConfigDirs(raw, dirname(file)), env);
}
