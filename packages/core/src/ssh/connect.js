import { isLocalTarget } from '../config/schema.js';
import { LocalExecutor } from '../local/executor.js';
import { SshExecutor } from './executor.js';

/**
 * @import { Config, Target } from '../config/schema.js'
 * @import { CommandExecutor } from './executor.js'
 */

/**
 * Returns a connector that opens an SSH session to a configured target,
 * tunnelling through its bastion when one is set. Local targets get a shell
 * on this machine instead.
 *
 * @param {Config} config
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {(targetName: string, target: Target) => Promise<CommandExecutor>}
 */
export function sshConnector(config, env = process.env) {
  return async (_targetName, target) => {
    if (isLocalTarget(target)) return new LocalExecutor();
    return SshExecutor.connect(
      target,
      target.bastion ? config.bastions[target.bastion] : undefined,
      env,
    );
  };
}
