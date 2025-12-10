import { Command } from 'commander';
import pc from 'picocolors';
import {
  DEFAULT_CONFIG_FILE,
  PipelineRunner,
  RunHistory,
  describeTarget,
  loadConfig,
  missingParams,
  paramDefaults,
  parseParamPairs,
  renderTemplate,
  sshConnector,
} from '@dops/core';
import { startServer } from '@dops/server';
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
    .command('sites')
    .description('list sites and the parameters they provide')
    .action(async () => {
      const { sites } = await config();
      for (const [name, params] of Object.entries(sites)) {
        const values = Object.entries(params).map(([k, v]) => `${k}=${v}`);
        ctx.write(`${pc.bold(name)}  ${pc.dim(values.join(' '))}\n`);
      }
    });

  program
    .command('deploy')
    .description('run a pipeline on its targets')
    .argument('<pipeline>', 'pipeline name')
    .option('-t, --target <name...>', 'run on these targets instead of the pipeline defaults')
    .option('-s, --site <name>', 'site whose parameters fill the {placeholders}')
    .option('-p, --param <key=value...>', 'values for {placeholders}, e.g. -p branch=release/2.4')
    .option('-n, --dry-run', 'print the commands without connecting anywhere')
    .action(
      async (
        pipelineName,
        /** @type {{ target?: string[], site?: string, param?: string[], dryRun?: boolean }} */ options,
      ) => {
        const cfg = await config();
        const pipeline = cfg.pipelines[pipelineName];
        if (!pipeline) {
          throw new Error(`Unknown pipeline "${pipelineName}". Run "dops pipelines" to list them.`);
        }
        let site;
        if (options.site) {
          const params = cfg.sites[options.site];
          if (!params) throw new Error(`Unknown site "${options.site}"`);
          site = { name: options.site, params };
        }
        const values = parseParamPairs(options.param ?? []);
        const defaults = paramDefaults(cfg);
        const missing = missingParams(pipeline, defaults, site?.params ?? {}, values);
        if (missing.length) {
          const hints = missing.map((key) => {
            const description = cfg.params[key]?.description;
            return `  -p ${key}=…${description ? `  (${description})` : ''}`;
          });
          throw new Error(`Missing values for ${missing.join(', ')}:\n${hints.join('\n')}`);
        }
        const targetNames = options.target ?? pipeline.targets;
        /** @type {Record<string, Target>} */
        const targets = {};
        for (const name of targetNames) {
          const target = cfg.targets[name];
          if (!target) throw new Error(`Unknown target "${name}"`);
          targets[name] = target;
        }

        if (options.dryRun) {
          for (const [name, target] of Object.entries(targets)) {
            ctx.write(`${pc.cyan(`[${name}]`)} ${pc.dim(describeTarget(target))}\n`);
            const params = {
              target: name,
              environment: target.environment ?? name,
              path: target.path,
              ...defaults,
              ...(site ? { site: site.name, ...site.params } : {}),
              ...values,
            };
            for (const step of pipeline.steps) {
              ctx.write(`  ${step.name}: ${renderTemplate(step.run, params)}\n`);
            }
          }
          return;
        }

        const runner = new PipelineRunner();
        runner.on('event', (event) => ctx.write(formatEvent(event)));
        const stopRecording = await ctx.history().record(runner);
        const record = await runner.run({
          pipelineName,
          pipeline,
          targets,
          ...(site ? { site } : {}),
          defaults,
          params: values,
          connect: ctx.connector(cfg),
        });
        await stopRecording();
        if (record.status !== 'ok') {
          process.exitCode = 1;
        }
      },
    );

  program
    .command('exec')
    .description('run one shell command on targets, e.g. dops exec -t web1 web2 -- drush status')
    .argument('<command...>', 'command to run (quote it or put it after --)')
    .requiredOption('-t, --target <name...>', 'targets to run on')
    .option('-s, --site <name>', 'site whose parameters fill {placeholders}')
    .option('-p, --param <key=value...>', 'values for {placeholders}')
    .action(
      async (
        /** @type {string[]} */ words,
        /** @type {{ target: string[], site?: string, param?: string[] }} */ options,
      ) => {
        const cfg = await config();
        const command = words.join(' ');
        /** @type {Record<string, Target>} */
        const targets = {};
        for (const name of options.target) {
          const target = cfg.targets[name];
          if (!target) throw new Error(`Unknown target "${name}"`);
          targets[name] = target;
        }
        let site;
        if (options.site) {
          const params = cfg.sites[options.site];
          if (!params) throw new Error(`Unknown site "${options.site}"`);
          site = { name: options.site, params };
        }
        const runner = new PipelineRunner();
        runner.on('event', (event) => ctx.write(formatEvent(event)));
        const stopRecording = await ctx.history().record(runner);
        const record = await runner.run({
          pipelineName: 'command',
          pipeline: {
            targets: options.target,
            steps: [{ name: command, run: command, continueOnError: true, timeoutSeconds: 1800 }],
          },
          targets,
          ...(site ? { site } : {}),
          defaults: paramDefaults(cfg),
          params: parseParamPairs(options.param ?? []),
          connect: ctx.connector(cfg),
        });
        await stopRecording();
        if (record.steps.some((step) => step.status !== 'ok')) process.exitCode = 1;
      },
    );

  program
    .command('serve')
    .description('start the dashboard (API + web UI) on localhost')
    .option('-p, --port <port>', 'port', '4800')
    .option('--host <host>', 'interface to bind; non-local needs DOPS_ALLOW_REMOTE=1', '127.0.0.1')
    .action(async (/** @type {{ port: string, host: string }} */ options) => {
      await startServer({
        configFile: program.opts().config,
        host: options.host,
        port: Number(options.port),
      });
    });

  const history = program.command('history').description('show previous runs');

  history
    .command('list', { isDefault: true })
    .description('list recent runs')
    .option('-l, --limit <n>', 'number of runs', '20')
    .option('-p, --pipeline <name>', 'only runs of this pipeline')
    .action(async (/** @type {{ limit: string, pipeline?: string }} */ options) => {
      const runs = await ctx.history().list({
        limit: Number(options.limit),
        ...(options.pipeline ? { pipeline: options.pipeline } : {}),
      });
      if (!runs.length) {
        ctx.write('No runs yet.\n');
        return;
      }
      for (const run of runs) {
        const status = run.status === 'ok' ? pc.green(run.status) : pc.red(run.status);
        ctx.write(
          `${pc.dim(run.startedAt.slice(0, 16).replace('T', ' '))}  ${status.padEnd(16)} ${run.pipeline} → ${run.targets.join(', ')}  ${pc.dim(run.id)}\n`,
        );
      }
    });

  history
    .command('show')
    .description('print the steps and output of a run')
    .argument('<id>', 'run id (from "dops history")')
    .action(async (id) => {
      const store = ctx.history();
      const run = await store.get(id);
      if (!run) throw new Error(`No run with id ${id}`);
      for (const step of run.steps) {
        ctx.write(`${step.status.padEnd(8)} [${step.target}] ${step.name}\n`);
      }
      ctx.write(`\n${(await store.readLog(id)) ?? '(no output recorded)'}\n`);
    });

  return program;
}
