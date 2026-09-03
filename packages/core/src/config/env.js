import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

/**
 * Loads KEY=value pairs from a .env file into `env`. Variables that are already
 * set win, so the shell can always override the file. A missing file is fine.
 *
 * @param {string} [file]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<string[]>} names of the variables taken from the file
 */
export async function loadEnvFile(file = '.env', env = process.env) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT') return [];
    throw error;
  }
  const loaded = [];
  for (const [key, value] of Object.entries(parseEnv(source))) {
    if (env[key] === undefined) {
      env[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}
