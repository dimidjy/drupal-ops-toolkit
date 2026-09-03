export { createProgram } from './program.js';
export { formatEvent } from './output.js';

/** @param {string[]} argv */
export async function main(argv) {
  const { loadEnvFile } = await import('@dops/core');
  await loadEnvFile(process.env.DOPS_ENV_FILE ?? '.env');
  const { createProgram } = await import('./program.js');
  await createProgram().parseAsync(argv);
}
