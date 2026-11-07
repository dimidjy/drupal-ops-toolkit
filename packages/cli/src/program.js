import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import {
  DEFAULT_CONFIG_FILE,
  PipelineRunner,
  RunHistory,
  BROWSERS,
  ProductionConfirmationError,
  assertProductionConfirmed,
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
import {
  ScheduleStore,
  TestHistory,
  notifyRun,
  pickRunOptions,
  runSuite,
  scheduleFile,
  startScheduler,
} from '@dops/ui-tests';
import {
  assertSafeLabel,
  captureSet,
  compareDirs,
  forEnvironment,
  writeReport,
} from '@dops/visual';
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
  loadConfig: (file) => loadConfig(file),
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

  /**
   * Refuses to touch production targets unless the run was confirmed with --yes.
   *
   * @param {Record<string, Target>} targets
   * @param {boolean | undefined} yes
   */
  const confirmProduction = (targets, yes) => {
    try {
      assertProductionConfirmed(targets, yes);
    } catch (error) {
      if (!(error instanceof ProductionConfirmationError)) throw error;
      throw new Error(
        `Production targets: ${error.targets.join(', ')}. Check what will run first, then pass --yes.`,
      );
    }
  };

  /**
   * Parses a --limit value: a whole number from 1 to 1000.
   *
   * @param {string} value
   */
  const parseLimit = (value) => {
    const limit = Number(value);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new InvalidArgumentError('expected a whole number from 1 to 1000');
    }
    return limit;
  };

  /**
   * A target's name, marked when it is a production server.
   *
   * @param {Config} cfg
   * @param {string} name
   */
  const targetLabel = (cfg, name) =>
    cfg.targets[name]?.production ? `${name} ${pc.red('(production)')}` : name;

  program
    .command('pipelines')
    .description('list the pipelines (runbooks) defined in the configuration')
    .action(async () => {
      const cfg = await config();
      for (const [name, pipeline] of Object.entries(cfg.pipelines)) {
        const targets = pipeline.targets.map((target) => targetLabel(cfg, target)).join(', ');
        ctx.write(`${pc.bold(name)}  ${pc.dim(`${pipeline.steps.length} steps →`)} ${targets}\n`);
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
    .command('run')
    .alias('deploy')
    .description('run a pipeline (runbook) on its targets')
    .argument('<pipeline>', 'pipeline name')
    .option('-t, --target <name...>', 'run on these targets instead of the pipeline defaults')
    .option('-s, --site <name>', 'site whose parameters fill the {placeholders}')
    .option('-p, --param <key=value...>', 'values for {placeholders}, e.g. -p branch=release/2.4')
    .option('-n, --dry-run', 'print the commands without connecting anywhere')
    .option('-y, --yes', 'confirm a run that includes production targets')
    .action(
      async (
        pipelineName,
        /** @type {{ target?: string[], site?: string, param?: string[], dryRun?: boolean, yes?: boolean }} */ options,
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
            const production = target.production ? ` ${pc.red('(production)')}` : '';
            ctx.write(`${pc.cyan(`[${name}]`)} ${pc.dim(describeTarget(target))}${production}\n`);
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

        confirmProduction(targets, options.yes);
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
    .option('-y, --yes', 'confirm a dump from a production target')
    .action(
      async (
        targetName,
        /** @type {{ site?: string, output?: string, import?: boolean, yes?: boolean }} */ options,
      ) => {
        const cfg = await config();
        const target = cfg.targets[targetName];
        if (!target) throw new Error(`Unknown target "${targetName}"`);
        const site = options.site ? cfg.sites[options.site] : {};
        if (!site) throw new Error(`Unknown site "${options.site}"`);
        confirmProduction({ [targetName]: target }, options.yes);
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
    .option('-y, --yes', 'confirm a command that includes production targets')
    .action(
      async (
        /** @type {string[]} */ words,
        /** @type {{ target: string[], site?: string, param?: string[], yes?: boolean }} */ options,
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
        confirmProduction(targets, options.yes);
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
   * An existing capture is only replaced with `force`, and only once the new one
   * has finished, so a failed run never destroys a baseline.
   *
   * @param {Config} cfg
   * @param {string} setName
   * @param {string} label
   * @param {string} [environment]
   * @param {boolean} [force]
   * @param {string[]} [paths] Pages to capture instead of the set's own list.
   * @returns {Promise<boolean>} false when a page did not load correctly
   */
  const capture = async (cfg, setName, label, environment, force = false, paths) => {
    assertSafeLabel(label);
    const configured = forEnvironment(urlSetOf(cfg, setName), environment);
    const urlSet = paths?.length ? { ...configured, paths } : configured;
    const outDir = join(cfg.visual.outputDir, setName, label);
    if (existsSync(outDir) && !force) {
      throw new Error(`Capture "${label}" already exists in ${outDir}; pass --force to replace it`);
    }
    const workDir = `${outDir}.partial`;
    await rm(workDir, { recursive: true, force: true });
    ctx.write(
      `${pc.bold(`Capturing ${urlSet.paths.length} pages`)} of ${urlSet.baseUrl} → ${outDir}\n`,
    );
    const results = await captureSet(urlSet, workDir, cfg.visual, (result) => {
      const status = result.broken
        ? pc.red(result.status >= 400 ? String(result.status) : 'broken')
        : pc.green(String(result.status));
      const reason = result.broken ? pc.dim(` · ${result.broken}`) : '';
      ctx.write(`  ${pc.dim(`[${label}]`)} ${status} ${result.path}${reason}\n`);
    });
    const meta = {
      label,
      environment: environment ?? null,
      baseUrl: urlSet.baseUrl,
      finishedAt: new Date().toISOString(),
      pages: results.map(({ path, status, broken }) => ({ path, status, broken: broken ?? null })),
    };
    await writeFile(join(workDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`);
    await rm(outDir, { recursive: true, force: true });
    await rename(workDir, outDir);
    const broken = results.filter((result) => result.broken);
    if (broken.length) {
      ctx.write(pc.red(`${broken.length} of ${results.length} pages did not load correctly\n`));
    }
    return !broken.length;
  };

  /**
   * Pages for a capture: those of an earlier capture (`like`), or the set's own
   * list plus `extra`. Undefined keeps the set's list as is.
   *
   * @param {Config} cfg
   * @param {string} setName
   * @param {string[]} extra
   * @param {string} [like]
   * @returns {Promise<string[] | undefined>}
   */
  const capturePaths = async (cfg, setName, extra, like) => {
    for (const path of extra) {
      if (!path.startsWith('/') || path.startsWith('//')) {
        throw new Error(`Bad path "${path}": use a path on the site, e.g. /events`);
      }
    }
    if (like) {
      assertSafeLabel(like);
      const file = join(cfg.visual.outputDir, setName, like, 'meta.json');
      if (!existsSync(file)) throw new Error(`Capture "${like}" not found (no ${file})`);
      /** @type {{ pages: { path: string }[] }} */
      const meta = JSON.parse(await readFile(file, 'utf8'));
      return meta.pages.map((page) => page.path);
    }
    if (!extra.length) return undefined;
    return [...new Set([...urlSetOf(cfg, setName).paths, ...extra])];
  };

  /**
   * Pages a finished capture recorded as broken (empty for captures made before
   * meta.json existed).
   *
   * @param {string} dir
   * @returns {Promise<{ path: string, broken: string }[]>}
   */
  const brokenPagesOf = async (dir) => {
    const file = join(dir, 'meta.json');
    if (!existsSync(file)) return [];
    /** @type {{ pages?: { path: string, broken: string | null }[] }} */
    const meta = JSON.parse(await readFile(file, 'utf8'));
    return (meta.pages ?? []).flatMap((page) =>
      page.broken ? [{ path: page.path, broken: page.broken }] : [],
    );
  };

  /**
   * Diffs two captures of a set and writes the HTML report.
   *
   * @param {Config} cfg
   * @param {string} setName
   * @param {string} before
   * @param {string} after
   * @param {string} title
   * @returns {Promise<{ changed: number, broken: number }>} pages that differ, and pages
   *   that did not load correctly in the "after" capture
   */
  const compare = async (cfg, setName, before, after, title) => {
    assertSafeLabel(before);
    assertSafeLabel(after);
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
    const broken = await brokenPagesOf(afterDir);
    if (broken.length) {
      ctx.write(
        pc.red(
          `${broken.length} page(s) did not load correctly in "${after}", so they cannot pass:\n`,
        ),
      );
      for (const page of broken)
        ctx.write(`  ${pc.red('broken ')} ${page.path} · ${page.broken}\n`);
    }
    return { changed, broken: broken.length };
  };

  /**
   * Exit code of a comparison: 2 when pages are broken, 1 when pages differ.
   *
   * @param {{ changed: number, broken: number }} outcome
   */
  const compareExitCode = ({ changed, broken }) => (broken ? 2 : changed ? 1 : 0);

  const visual = program.command('visual').description('screenshot pages and compare them');

  visual
    .command('capture')
    .description('screenshot every page of a URL set')
    .argument('<set>', 'URL set from visual.urlSets')
    .option('--label <label>', 'name of this capture (default: environment or "before")')
    .option('-e, --env <name>', 'capture one of the environments listed in the URL set')
    .option('--force', 'replace an existing capture with the same label')
    .option('--path <path...>', 'extra pages to capture besides the set, e.g. /events')
    .option('--like <label>', 'capture the same pages as an earlier capture of the set')
    .action(
      async (
        setName,
        /** @type {{ label?: string, env?: string, force?: boolean, path?: string[], like?: string }} */ options,
      ) => {
        const cfg = await config();
        const label = options.label ?? options.env ?? 'before';
        const paths = await capturePaths(cfg, setName, options.path ?? [], options.like);
        if (!(await capture(cfg, setName, label, options.env, options.force, paths))) {
          process.exitCode = 1;
        }
      },
    );

  visual
    .command('compare')
    .description('diff two captures of a URL set')
    .argument('<set>', 'URL set from visual.urlSets')
    .option('--before <label>', 'baseline capture', 'before')
    .option('--after <label>', 'capture to check', 'after')
    .action(async (setName, /** @type {{ before: string, after: string }} */ options) => {
      const cfg = await config();
      const title = `Visual diff · ${setName}`;
      const outcome = await compare(cfg, setName, options.before, options.after, title);
      if (compareExitCode(outcome)) process.exitCode = compareExitCode(outcome);
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
        capture(cfg, setName, a, a, true),
        capture(cfg, setName, b, b, true),
      ]);
      const outcome = await compare(cfg, setName, a, b, `A/B · ${setName}: ${a} vs ${b}`);
      const code = compareExitCode(outcome) || (captured.includes(false) ? 2 : 0);
      if (code) process.exitCode = code;
    });

  /**
   * Stores a finished run and sends the webhook notification if configured.
   *
   * @param {import('@dops/core').UiTestsConfig} uiTests
   * @param {import('@dops/ui-tests').UiTestRun} run
   */
  const recordTestRun = async (uiTests, run) => {
    const store = new TestHistory(uiTests.outputDir);
    const [previous] = await store.list({ suite: run.suite, limit: 1 });
    await store.append(run);
    ctx.write(formatTestRun(run));
    try {
      if (await notifyRun(run, previous, uiTests.notify))
        ctx.write(pc.dim('  notification sent\n'));
    } catch (error) {
      ctx.write(
        pc.yellow(`  notification failed: ${error instanceof Error ? error.message : error}\n`),
      );
    }
  };

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
    .option('-f, --file <spec>', 'only this spec file of the suite')
    .option('-e, --env <name>', 'run against one of the suite environments')
    .option('-b, --browser <name>', 'chromium, firefox, webkit or mobile', 'chromium')
    .option('-u, --url <url...>', 'URLs for the specs (DOPS_TEST_URLS)')
    .option('-q, --quiet', 'only print the summary')
    .action(
      async (
        /** @type {string[]} */ names,
        /** @type {{ file?: string, env?: string, browser: string, url?: string[], quiet?: boolean }} */ options,
      ) => {
        const { uiTests } = await config();
        for (const name of names) {
          const suite = uiTests.suites[name];
          if (!suite) throw new Error(`Unknown suite "${name}"`);
          if (options.env && !suite.environments[options.env]) {
            const known = Object.keys(suite.environments).join(', ') || 'none defined';
            throw new Error(`Suite "${name}" has no environment "${options.env}" (${known})`);
          }
        }
        if (!BROWSERS.includes(/** @type {any} */ (options.browser))) {
          throw new Error(`Unknown browser "${options.browser}" (${BROWSERS.join(', ')})`);
        }
        let failed = false;
        for (const name of names) {
          const suite = /** @type {import('@dops/core').UiSuite} */ (uiTests.suites[name]);
          const baseUrl = options.env ? suite.environments[options.env] : suite.baseUrl;
          ctx.write(
            `${pc.bold(`Running ${name}`)} ${pc.dim(`against ${baseUrl ?? options.env}`)}\n`,
          );
          const run = await runSuite(name, suite, {
            outputDir: uiTests.outputDir,
            trigger: 'cli',
            browser: /** @type {import('@dops/core').UiRunOptions['browser']} */ (options.browser),
            ...(options.file ? { testFile: options.file } : {}),
            ...(options.env ? { environment: options.env } : {}),
            ...(options.url ? { urls: options.url } : {}),
            ...(options.quiet ? {} : { onOutput: (chunk) => ctx.write(pc.dim(chunk)) }),
          });
          await recordTestRun(uiTests, run);
          failed ||= run.status !== 'passed';
        }
        if (failed) process.exitCode = 1;
      },
    );

  tests
    .command('schedule')
    .description('keep running and start suites on their schedules (config and dashboard)')
    .action(async () => {
      const { uiTests } = await config();
      const fromDashboard = (await new ScheduleStore(scheduleFile(uiTests)).list()).filter(
        (schedule) => schedule.enabled,
      );
      const schedules = [...uiTests.schedules, ...fromDashboard];
      if (!schedules.length) throw new Error('No uiTests.schedules configured');
      const scheduler = startScheduler(schedules, {
        run: async (schedule) => {
          const suite = /** @type {import('@dops/core').UiSuite} */ (
            uiTests.suites[schedule.suite]
          );
          ctx.write(
            `${pc.dim(new Date().toISOString())} ${pc.bold(`Running ${schedule.suite}`)}\n`,
          );
          const run = await runSuite(schedule.suite, suite, {
            outputDir: uiTests.outputDir,
            trigger: `schedule:${schedule.name ?? schedule.cron}`,
            ...pickRunOptions(schedule),
          });
          await recordTestRun(uiTests, run);
        },
        onSkip: (name) => ctx.write(pc.yellow(`${name} is still running, skipping this trigger\n`)),
        onError: (name, error) =>
          ctx.write(pc.red(`${name}: ${error instanceof Error ? error.message : error}\n`)),
      });
      for (const { schedule, task } of scheduler.scheduled) {
        const next = task.getNextRun()?.toLocaleString() ?? 'never';
        const label = schedule.name ? `${schedule.name} (${schedule.suite})` : schedule.suite;
        ctx.write(`${pc.bold(label)}  ${schedule.cron}  ${pc.dim(`next: ${next}`)}\n`);
      }
      ctx.write(pc.dim('Waiting for schedules, Ctrl+C to stop.\n'));
      await new Promise((resolve) => {
        process.once('SIGINT', resolve);
        process.once('SIGTERM', resolve);
      });
      await scheduler.stop();
    });

  tests
    .command('history')
    .description('list recent test runs')
    .option('--suite <name>', 'only runs of this suite')
    .option('-l, --limit <n>', 'number of runs (1 to 1000)', parseLimit, 20)
    .action(async (/** @type {{ suite?: string, limit: number }} */ options) => {
      const { uiTests } = await config();
      const runs = await new TestHistory(uiTests.outputDir).list({
        limit: options.limit,
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
    .option('-l, --limit <n>', 'number of runs (1 to 1000)', parseLimit, 20)
    .option('--pipeline <name>', 'only runs of this pipeline')
    .action(async (/** @type {{ limit: number, pipeline?: string }} */ options) => {
      const runs = await ctx.history().list({
        limit: options.limit,
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
