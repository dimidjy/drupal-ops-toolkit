export { createProgram } from './program.js';
export { formatEvent } from './output.js';

/**
 * Secrets come from the project's env file, which loadConfig reads for every
 * command (DOPS_ENV_FILE, the config's envFile, then .env next to the config).
 *
 * @param {string[]} argv
 */
export async function main(argv) {
  const { createProgram } = await import('./program.js');
  await createProgram().parseAsync(argv);
}
