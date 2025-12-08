import { spawn } from 'node:child_process';
import { expandHome } from '../config/load.js';
import { CommandTimeoutError } from '../ssh/executor.js';

/**
 * @import { CommandExecutor, ExecOptions, ExecResult } from '../ssh/executor.js'
 */

/**
 * Runs commands in a shell on this machine, with the same interface as the
 * SSH executor so pipelines don't care where a target lives.
 *
 * @implements {CommandExecutor}
 */
export class LocalExecutor {
  /**
   * @param {string} command
   * @param {ExecOptions} [options]
   * @returns {Promise<ExecResult>}
   */
  exec(command, options = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        shell: true,
        cwd: expandHome(options.cwd ?? '.'),
        stdio: ['ignore', 'pipe', 'pipe'],
        // Own process group, so stopping also stops what the shell started.
        detached: process.platform !== 'win32',
      });
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const stop = () => {
        try {
          if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM');
          else child.kill('SIGTERM');
        } catch {
          // Already gone.
        }
      };
      const abort = stop;
      if (options.timeoutMs) {
        const { timeoutMs } = options;
        timer = setTimeout(() => {
          stop();
          reject(new CommandTimeoutError(command, timeoutMs));
        }, timeoutMs);
      }
      options.signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', (/** @type {Buffer} */ data) => options.onStdout?.(data.toString()));
      child.stderr.on('data', (/** @type {Buffer} */ data) => options.onStderr?.(data.toString()));
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abort);
        resolve({ code: code ?? 1, ...(signal ? { signal } : {}) });
      });
    });
  }

  async close() {}
}
