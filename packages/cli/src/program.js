import { Command } from 'commander';
import pc from 'picocolors';
import {
  DEFAULT_CONFIG_FILE,
  PipelineRunner,
  RunHistory,
  loadConfig,
  sshConnector,
} from '@dops/core';
import { formatEvent } from './output.js';

/** @import { Config, Target, CommandExecutor } from '@dops/core' */

/**
 * Everything the commands touch from the outside world, injectable for tests.
 *
 * @typedef {object} Context
 * @property {(file: string) => Promise<Config>} loadConfig
 * @property {(config: Config) => (name: string, target: Target) => Promise<CommandExecutor>} connector
 * @property {(dir?: string) => RunHistory} history
 * @property {(text: string) => void} write
 */

/** @type {Context} */
export const defaultContext = {
  loadConfig: (file) => loadConfig(file),
  connector: (config) => sshConnector(config),
  history: (dir) => new RunHistory(dir),
  write: (text) => process.stdout.write(text),
};

/**
 * @param {Partial<Context>} [overrides]
 */
export function createProgram(overrides = {}) {
  const ctx = { ...defaultContext, ...overrides };
  const program = new Command('dops')
    .description('Deploy, QA and review automation for Drupal projects')
    .option('-c, --config <file>', 'configuration file', DEFAULT_CONFIG_FILE)
    .showHelpAfterError();

  const config = () => ctx.loadConfig(program.opts().config);

  program
    .command('pipelines')
    .description('list the pipelines defined in the configuration')
    .action(async () => {
      const { pipelines } = await config();
      for (const [name, pipeline] of Object.entries(pipelines)) {
        ctx.write(
          `${pc.bold(name)}  ${pc.dim(`${pipeline.steps.length} steps → ${pipeline.targets.join(', ')}`)}\n`,
        );
        if (pipeline.description) ctx.write(`  ${pipeline.description}\n`);
      }
    });

  program
    .command('deploy')
    .description('run a pipeline on its targets')
    .argument('<pipeline>', 'pipeline name')
    .option('-t, --target <name...>', 'run on these targets instead of the pipeline defaults')
    .action(async (pipelineName, /** @type {{ target?: string[] }} */ options) => {
      const cfg = await config();
      const pipeline = cfg.pipelines[pipelineName];
      if (!pipeline) {
        throw new Error(`Unknown pipeline "${pipelineName}". Run "dops pipelines" to list them.`);
      }
      const targetNames = options.target ?? pipeline.targets;
      /** @type {Record<string, Target>} */
      const targets = {};
      for (const name of targetNames) {
        const target = cfg.targets[name];
        if (!target) throw new Error(`Unknown target "${name}"`);
        targets[name] = target;
      }

      const runner = new PipelineRunner();
      runner.on('event', (event) => ctx.write(formatEvent(event)));
      const stopRecording = await ctx.history().record(runner);
      const record = await runner.run({
        pipelineName,
        pipeline,
        targets,
        connect: ctx.connector(cfg),
      });
      await stopRecording();
      if (record.status !== 'ok') {
        process.exitCode = 1;
      }
    });

  return program;
}
