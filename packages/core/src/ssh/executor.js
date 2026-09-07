import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import ssh2 from 'ssh2';
import { expandHome } from '../config/load.js';

const { Client } = ssh2;

/**
 * @typedef {object} ExecOptions
 * @property {string} [cwd]
 * @property {number} [timeoutMs]
 * @property {(chunk: string) => void} [onStdout]
 * @property {NodeJS.WritableStream} [stdout] Raw stdout (binary safe); replaces onStdout.
 * @property {(chunk: string) => void} [onStderr]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} ExecResult
 * @property {number} code
 * @property {string} [signal]
 */

/**
 * Runs shell commands somewhere: over SSH in production, in memory in tests.
 *
 * @typedef {object} CommandExecutor
 * @property {(command: string, options?: ExecOptions) => Promise<ExecResult>} exec
 * @property {() => Promise<void>} close
 */

/**
 * @typedef {Pick<import('../config/schema.js').SshTarget,
 *   'host' | 'port' | 'user' | 'identityFile' | 'passphraseEnv' | 'agent' | 'hostFingerprint'>} Endpoint
 */

export class CommandTimeoutError extends Error {
  /**
   * @param {string} command
   * @param {number} timeoutMs
   */
  constructor(command, timeoutMs) {
    super(`Command timed out after ${timeoutMs / 1000}s: ${command}`);
    this.name = 'CommandTimeoutError';
  }
}

/**
 * Quotes a value for POSIX sh.
 * @param {string} value
 */
export function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * @param {string} command
 * @param {string} [cwd]
 */
export function buildRemoteCommand(command, cwd) {
  return cwd && cwd !== '.' ? `cd ${shellQuote(cwd)} && ${command}` : command;
}

/**
 * Builds ssh2 connection settings; reads the key file and passphrase, never a password.
 *
 * @param {Endpoint} endpoint
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<import('ssh2').ConnectConfig>}
 */
export async function connectionSettings(endpoint, env = process.env) {
  /** @type {import('ssh2').ConnectConfig} */
  const settings = {
    host: endpoint.host,
    port: endpoint.port,
    username: endpoint.user,
    readyTimeout: 20_000,
    keepaliveInterval: 15_000,
  };
  if (endpoint.identityFile) {
    settings.privateKey = await readFile(expandHome(endpoint.identityFile));
    if (endpoint.passphraseEnv) {
      const passphrase = env[endpoint.passphraseEnv];
      if (!passphrase) {
        throw new Error(`Environment variable ${endpoint.passphraseEnv} is not set`);
      }
      settings.passphrase = passphrase;
    }
  }
  if (endpoint.agent) {
    if (!env.SSH_AUTH_SOCK) {
      throw new Error('agent: true but SSH_AUTH_SOCK is not set');
    }
    settings.agent = env.SSH_AUTH_SOCK;
  }
  if (endpoint.hostFingerprint) {
    const expected = endpoint.hostFingerprint.replace(/^SHA256:/, '');
    settings.hostVerifier = (/** @type {Buffer} */ key) =>
      createHash('sha256').update(key).digest('base64').replace(/=+$/, '') === expected;
  }
  return settings;
}

/**
 * @param {import('ssh2').ConnectConfig} settings
 * @returns {Promise<import('ssh2').Client>}
 */
function connect(settings) {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .once('ready', () => resolve(client))
      .once('error', reject)
      .connect(settings);
  });
}

/**
 * Opens a TCP tunnel from the bastion to the target's SSH port.
 *
 * @param {import('ssh2').Client} bastion
 * @param {string} host
 * @param {number} port
 * @returns {Promise<import('ssh2').ClientChannel>}
 */
function forward(bastion, host, port) {
  return new Promise((resolve, reject) => {
    bastion.forwardOut('127.0.0.1', 0, host, port, (error, stream) =>
      error ? reject(error) : resolve(stream),
    );
  });
}

/** @implements {CommandExecutor} */
export class SshExecutor {
  /**
   * @param {import('ssh2').Client} client
   * @param {import('ssh2').Client} [bastion]
   */
  constructor(client, bastion) {
    this.client = client;
    this.bastion = bastion;
  }

  /**
   * @param {import('../config/schema.js').SshTarget} target
   * @param {import('../config/schema.js').Bastion} [bastion]
   * @param {NodeJS.ProcessEnv} [env]
   */
  static async connect(target, bastion, env = process.env) {
    const targetSettings = await connectionSettings(target, env);
    if (!bastion) {
      return new SshExecutor(await connect(targetSettings));
    }
    const jump = await connect(await connectionSettings(bastion, env));
    try {
      const sock = await forward(jump, target.host, target.port);
      return new SshExecutor(await connect({ ...targetSettings, sock }), jump);
    } catch (error) {
      jump.end();
      throw error;
    }
  }

  /**
   * @param {string} command
   * @param {ExecOptions} [options]
   * @returns {Promise<ExecResult>}
   */
  exec(command, options = {}) {
    const remote = buildRemoteCommand(command, options.cwd);
    return new Promise((resolve, reject) => {
      this.client.exec(remote, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        /** @type {NodeJS.Timeout | undefined} */
        let timer;
        const abort = () => channel.close();
        const { timeoutMs } = options;
        if (timeoutMs) {
          timer = setTimeout(() => {
            channel.close();
            reject(new CommandTimeoutError(command, timeoutMs));
          }, timeoutMs);
        }
        options.signal?.addEventListener('abort', abort, { once: true });
        if (options.stdout) {
          channel.pipe(options.stdout, { end: false });
        } else {
          channel.on('data', (/** @type {Buffer} */ data) => options.onStdout?.(data.toString()));
        }
        channel.stderr.on('data', (/** @type {Buffer} */ data) =>
          options.onStderr?.(data.toString()),
        );
        channel.on('close', (/** @type {number | null} */ code, /** @type {string} */ signal) => {
          clearTimeout(timer);
          options.signal?.removeEventListener('abort', abort);
          resolve({ code: code ?? 1, ...(signal ? { signal } : {}) });
        });
      });
    });
  }

  async close() {
    this.client.end();
    this.bastion?.end();
  }
}
