import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import {
  DEFAULT_CONFIG_FILE,
  PipelineRunner,
  RunHistory,
  Workspace,
  describeTarget,
  dumpFileName,
  loadConfig,
  missingParams,
  paramDefaults,
  parseParamPairs,
  pullDatabase,
  renderTemplate,
  shellQuote,
  sshConnector,
} from '@dops/core';
import { startServer } from '@dops/server';
import { TestHistory, runSuite } from '@dops/ui-tests';
import { captureSet, compareDirs, forEnvironment, writeReport } from '@dops/visual';
import { formatEvent, formatTestRun } from './output.js';

/** @import { Config, Target, CommandExecutor } from '@dops/core' */

/**
 * Everything the commands touch from the outside world, injectable for tests.
 *
 * @typedef {object} Context
 * @property {(file: string) => Promise<Config>} loadConfig
 * @property {(config: Config) => (name: string, target: Target) => Promise<CommandExecutor>} connector
 * @property {(dir?: string) => RunHistory} history
 * @property {(text: string) => void} write
 * @property {(command: string) => Promise<number>} runLocal Runs a shell command on this machine.
 */

/** @type {Context} */
export const defaultContext = {
  loadConfig: async (file) => {
    const config = await loadConfig(file);
    // Pipelines and parameters created in the dashboard work from the CLI too.
    await Workspace.open(config.dashboard.workspaceFile, config);
    return config;
  },
  connector: (config) => sshConnector(config),
  history: (dir) => new RunHistory(dir),
  write: (text) => process.stdout.write(text),
  runLocal: (command) =>
    new Promise((resolve, reject) => {
      spawn(command, { shell: true, stdio: 'inherit' })
        .on('error', reject)
        .on('close', (code) => resolve(code ?? 1));
    }),
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

  const db = program.command('db').description('database helpers');

  db.command('pull')
    .description('stream a gzipped database dump from a target to a local file')
    .argument('<target>', 'target name')
    .option('-s, --site <name>', 'site whose parameters fill the dump command')
    .option('-o, --output <file>', 'where to write the dump')
    .option('-i, --import', 'import the dump locally afterwards (db.importCommand)')
    .action(
      async (
        targetName,
        /** @type {{ site?: string, output?: string, import?: boolean }} */ options,
      ) => {
        const cfg = await config();
        const target = cfg.targets[targetName];
        if (!target) throw new Error(`Unknown target "${targetName}"`);
        const site = options.site ? cfg.sites[options.site] : {};
        if (!site) throw new Error(`Unknown site "${options.site}"`);
        const command = renderTemplate(cfg.db.dumpCommand, {
          alias: '@self',
          target: targetName,
          environment: target.environment ?? targetName,
          path: target.path,
          ...site,
        });
        const file = options.output ?? dumpFileName(cfg.db.outputDir, targetName, options.site);
        ctx.write(`${pc.cyan(`[${targetName}]`)} ${pc.dim(command)}\n`);
        const executor = await ctx.connector(cfg)(targetName, target);
        try {
          const result = await pullDatabase({
            executor,
            command,
            cwd: target.path,
            file,
            timeoutMs: cfg.db.timeoutSeconds * 1000,
          });
          const mb = (result.bytes / 1024 / 1024).toFixed(1);
          const seconds = (result.durationMs / 1000).toFixed(0);
          ctx.write(`${pc.green('✔')} ${result.file} (${mb} MB in ${seconds}s)\n`);
        } finally {
          await executor.close();
        }
        if (options.import) {
          const importCommand = renderTemplate(cfg.db.importCommand, { file: shellQuote(file) });
          ctx.write(`${pc.bold('Importing')} ${pc.dim(importCommand)}\n`);
          const code = await ctx.runLocal(importCommand);
          if (code !== 0) throw new Error(`Import failed with exit code ${code}`);
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

  /**
   * @param {Config} cfg
   * @param {string} setName
   */
  const urlSetOf = (cfg, setName) => {
    const urlSet = cfg.visual.urlSets[setName];
    if (!urlSet) throw new Error(`Unknown URL set "${setName}"`);
    return urlSet;
  };

  /**
   * Screenshots a URL set (optionally one of its environments) into `<set>/<label>`.
   *
   * @param {Config} cfg
   * @param {string} setName
   * @param {string} label
   * @param {string} [environment]
   * @returns {Promise<boolean>} false when a page failed to load
   */
  const capture = async (cfg, setName, label, environment) => {
    const urlSet = forEnvironment(urlSetOf(cfg, setName), environment);
    const outDir = join(cfg.visual.outputDir, setName, label);
    ctx.write(
      `${pc.bold(`Capturing ${urlSet.paths.length} pages`)} of ${urlSet.baseUrl} → ${outDir}\n`,
    );
    const results = await captureSet(urlSet, outDir, cfg.visual, (result) => {
      const status = result.error
        ? pc.red(result.error.split('\n')[0] ?? 'error')
        : result.status >= 400
          ? pc.yellow(String(result.status))
          : pc.green(String(result.status));
      ctx.write(`  ${pc.dim(`[${label}]`)} ${status} ${result.path}\n`);
    });
    return !results.some((result) => result.error);
  };

  /**
   * Diffs two captures of a set and writes the HTML report.
   *
   * @param {Config} cfg
   * @param {string} setName
   * @param {string} before
   * @param {string} after
   * @param {string} title
   * @returns {Promise<number>} number of pages that differ
   */
  const compare = async (cfg, setName, before, after, title) => {
    urlSetOf(cfg, setName);
    const dir = join(cfg.visual.outputDir, setName);
    const beforeDir = join(dir, before);
    const afterDir = join(dir, after);
    const pair = `${before}-${after}`;
    const results = await compareDirs(
      { beforeDir, afterDir, diffDir: join(dir, `diff-${pair}`) },
      cfg.visual,
    );
    if (!results.length) throw new Error(`No screenshots found in ${dir}`);
    for (const result of results) {
      const label = {
        same: pc.green('same   '),
        changed: pc.red('changed'),
        added: pc.yellow('added  '),
        removed: pc.yellow('removed'),
      }[result.status];
      const ratio = result.diffFile
        ? pc.dim(` ${(result.ratio * 100).toFixed(2)}% · ${result.diffPixels} px`)
        : '';
      ctx.write(`  ${label} ${result.name}${ratio}\n`);
    }
    const changed = results.filter((result) => result.status !== 'same').length;
    const report = await writeReport(
      { title, beforeDir, afterDir, beforeLabel: before, afterLabel: after, results },
      join(dir, `report-${pair}.html`),
    );
    ctx.write(`\n${changed} of ${results.length} pages differ · report: ${report}\n`);
    return changed;
  };

  const visual = program.command('visual').description('screenshot pages and compare them');

  visual
    .command('capture')
    .description('screenshot every page of a URL set')
    .argument('<set>', 'URL set from visual.urlSets')
    .option('-l, --label <label>', 'name of this capture (default: environment or "before")')
    .option('-e, --env <name>', 'capture one of the environments listed in the URL set')
    .action(async (setName, /** @type {{ label?: string, env?: string }} */ options) => {
      const cfg = await config();
      const label = options.label ?? options.env ?? 'before';
      if (!(await capture(cfg, setName, label, options.env))) process.exitCode = 1;
    });

  visual
    .command('compare')
    .description('diff two captures of a URL set')
    .argument('<set>', 'URL set from visual.urlSets')
    .option('--before <label>', 'baseline capture', 'before')
    .option('--after <label>', 'capture to check', 'after')
    .action(async (setName, /** @type {{ before: string, after: string }} */ options) => {
      const cfg = await config();
      const title = `Visual diff · ${setName}`;
      if (await compare(cfg, setName, options.before, options.after, title)) process.exitCode = 1;
    });

  visual
    .command('ab')
    .description('capture two environments of a URL set side by side and diff them')
    .argument('<set>', 'URL set from visual.urlSets')
    .argument('<a>', 'baseline environment, e.g. prod')
    .argument('<b>', 'environment to check, e.g. stage')
    .action(async (setName, a, b) => {
      if (a === b) throw new Error('Pick two different environments');
      const cfg = await config();
      const captured = await Promise.all([
        capture(cfg, setName, a, a),
        capture(cfg, setName, b, b),
      ]);
      const changed = await compare(cfg, setName, a, b, `A/B · ${setName}: ${a} vs ${b}`);
      if (changed || captured.includes(false)) process.exitCode = 1;
    });

  const tests = program.command('test').description('run Playwright UI test suites');

  tests
    .command('list')
    .description('list the configured suites')
    .action(async () => {
      const { uiTests } = await config();
      for (const [name, suite] of Object.entries(uiTests.suites)) {
        ctx.write(`${pc.bold(name)}  ${pc.dim(`${suite.testDir} → ${suite.baseUrl}`)}\n`);
      }
    });

  tests
    .command('run')
    .description('run one or more suites and record the results')
    .argument('<suites...>', 'suite names')
    .option('-q, --quiet', 'only print the summary')
    .action(async (/** @type {string[]} */ names, /** @type {{ quiet?: boolean }} */ options) => {
      const { uiTests } = await config();
      for (const name of names) {
        if (!uiTests.suites[name]) throw new Error(`Unknown suite "${name}"`);
      }
      const store = new TestHistory(uiTests.outputDir);
      let failed = false;
      for (const name of names) {
        const suite = /** @type {import('@dops/core').UiSuite} */ (uiTests.suites[name]);
        ctx.write(`${pc.bold(`Running ${name}`)} ${pc.dim(`against ${suite.baseUrl}`)}\n`);
        const run = await runSuite(name, suite, {
          outputDir: uiTests.outputDir,
          ...(options.quiet ? {} : { onOutput: (chunk) => ctx.write(pc.dim(chunk)) }),
        });
        await store.append(run);
        ctx.write(formatTestRun(run));
        failed ||= run.status !== 'passed';
      }
      if (failed) process.exitCode = 1;
    });

  tests
    .command('history')
    .description('list recent test runs')
    .option('-s, --suite <name>', 'only runs of this suite')
    .option('-l, --limit <n>', 'number of runs', '20')
    .action(async (/** @type {{ suite?: string, limit: string }} */ options) => {
      const { uiTests } = await config();
      const runs = await new TestHistory(uiTests.outputDir).list({
        limit: Number(options.limit),
        ...(options.suite ? { suite: options.suite } : {}),
      });
      if (!runs.length) ctx.write('No test runs yet.\n');
      for (const run of runs) {
        const status = run.status === 'passed' ? pc.green(run.status) : pc.red(run.status);
        const counts = run.stats
          ? `${run.stats.passed}/${run.stats.passed + run.stats.failed}`
          : '';
        ctx.write(
          `${pc.dim(run.startedAt.slice(0, 16).replace('T', ' '))}  ${status.padEnd(16)} ${run.suite} ${counts}  ${pc.dim(run.id)}\n`,
        );
      }
    });

  tests
    .command('show')
    .description('print the failures and report location of a test run')
    .argument('<id>', 'run id (from "dops test history")')
    .action(async (id) => {
      const { uiTests } = await config();
      const run = await new TestHistory(uiTests.outputDir).get(id);
      if (!run) throw new Error(`No test run with id ${id}`);
      ctx.write(formatTestRun(run));
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
