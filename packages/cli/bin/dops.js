#!/usr/bin/env node
import { main } from '../src/index.js';

// `dops history | head` closes stdout early; that is not an error.
process.stdout.on('error', (error) => {
  if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EPIPE') process.exit(0);
  throw error;
});

main(process.argv).catch((error) => {
  const debug = Boolean(process.env.DOPS_DEBUG);
  const message = error instanceof Error ? (debug ? error.stack : error.message) : String(error);
  console.error(`dops: ${message}`);
  process.exitCode = 1;
});
