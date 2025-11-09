export { createProgram } from './program.js';
export { formatEvent } from './output.js';

/** @param {string[]} argv */
export async function main(argv) {
  const { createProgram } = await import('./program.js');
  await createProgram().parseAsync(argv);
}
