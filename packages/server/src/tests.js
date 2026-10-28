import { EventEmitter } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  ScheduleStore,
  TestHistory,
  notifyRun,
  pickRunOptions,
  runSuite as defaultRunSuite,
  scheduleFile,
  startScheduler,
} from '@dops/ui-tests';
import { RunConflictError } from './runs.js';

/**
 * @import { UiRunOptions, UiTestsConfig } from '@dops/core'
 * @import { UiTestRun } from '@dops/ui-tests'
 */

/**
 * Starts UI test suites in the background, one run per suite at a time, and
 * can stop them. Emits "finished" with the run once it is stored.
 */
export class TestRunManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {UiTestsConfig} options.uiTests
   * @param {typeof defaultRunSuite} [options.runSuite]
   */
  constructor({ uiTests, runSuite = defaultRunSuite }) {
    super();
    this.uiTests = uiTests;
    this.runSuite = runSuite;
    this.history = new TestHistory(uiTests.outputDir);
    /**
     * @type {Map<string, { suite: string, startedAt: string, testFile?: string,
     *   environment?: string, browser?: string, controller: AbortController, done: Promise<void> }>}
     */
    this.active = new Map();
  }

  /**
   * @param {string} name
   * @param {UiRunOptions & { trigger?: string }} [options]
   */
  start(name, options = {}) {
    const suite = this.uiTests.suites[name];
    if (!suite) throw new Error(`Unknown suite "${name}"`);
    if (this.active.has(name)) throw new RunConflictError(`Suite "${name}" is already running`);
    if (options.environment && !suite.environments[options.environment]) {
      throw Object.assign(new Error(`Unknown environment "${options.environment}"`), {
        statusCode: 400,
      });
    }
    const controller = new AbortController();
    const entry = {
      suite: name,
      startedAt: new Date().toISOString(),
      ...(options.testFile ? { testFile: options.testFile } : {}),
      ...(options.environment ? { environment: options.environment } : {}),
      browser: options.browser ?? 'chromium',
      controller,
      done: Promise.resolve(),
    };
    entry.done = this.#run(name, suite, { ...options, signal: controller.signal });
    this.active.set(name, entry);
    return entry;
  }

  /** @param {string} name */
  stop(name) {
    const entry = this.active.get(name);
    entry?.controller.abort();
    return Boolean(entry);
  }

  /**
   * @param {string} name
   * @param {import('@dops/core').UiSuite} suite
   * @param {UiRunOptions & { trigger?: string, signal: AbortSignal }} options
   */
  async #run(name, suite, options) {
    try {
      const run = await this.runSuite(name, suite, {
        outputDir: this.uiTests.outputDir,
        ...options,
      });
      const [previous] = await this.history.list({ suite: name, limit: 1 });
      await this.history.append(run);
      await notifyRun(run, previous, this.uiTests.notify).catch(() => false);
      this.emit('finished', run);
    } finally {
      this.active.delete(name);
    }
  }

  /**
   * Browser URL of a run's Playwright report, served under /reports/ui-tests/.
   *
   * @param {UiTestRun} run
   */
  reportUrl(run) {
    const path = relative(resolve(this.uiTests.outputDir), run.reportDir).split('\\').join('/');
    return path.startsWith('..') ? null : `/reports/ui-tests/${path}/index.html`;
  }
}

/**
 * Visual diff reports on disk (`<outputDir>/<set>/report-<a>-<b>.html`), newest first.
 *
 * @param {string} outputDir
 */
export async function listVisualReports(outputDir) {
  /** @type {{ set: string, name: string, url: string, modifiedAt: string }[]} */
  const reports = [];
  let sets;
  try {
    sets = await readdir(outputDir, { withFileTypes: true });
  } catch {
    return reports;
  }
  for (const set of sets.filter((entry) => entry.isDirectory())) {
    for (const file of await readdir(join(outputDir, set.name))) {
      const match = /^report-(.+)\.html$/.exec(file);
      if (!match) continue;
      const { mtime } = await stat(join(outputDir, set.name, file));
      reports.push({
        set: set.name,
        name: /** @type {string} */ (match[1]).replace('-', ' → '),
        url: `/reports/visual/${encodeURIComponent(set.name)}/${encodeURIComponent(file)}`,
        modifiedAt: mtime.toISOString(),
      });
    }
  }
  return reports.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/**
 * Runs the config and dashboard schedules inside `dops serve` and restarts
 * them whenever the dashboard changes one.
 */
export class TestSchedules {
  /**
   * @param {UiTestsConfig} uiTests
   * @param {TestRunManager} tests
   */
  constructor(uiTests, tests) {
    this.uiTests = uiTests;
    this.tests = tests;
    this.store = new ScheduleStore(scheduleFile(uiTests));
    /** @type {ReturnType<typeof startScheduler> | null} */
    this.scheduler = null;
    this.active = false;
  }

  /** All schedules with their origin and next run (when the scheduler is active). */
  async list() {
    const stored = await this.store.list();
    const all = [
      ...this.uiTests.schedules.map((schedule, index) => ({
        ...schedule,
        id: `config-${index}`,
        enabled: true,
        source: 'config',
      })),
      ...stored.map((schedule) => ({ ...schedule, source: 'dashboard' })),
    ];
    const tasks = new Map(this.scheduler?.scheduled.map(({ schedule, task }) => [schedule, task]));
    return all.map((schedule) => {
      const task = [...tasks.entries()].find(
        ([s]) => /** @type {any} */ (s).id === schedule.id,
      )?.[1];
      return { ...schedule, nextRun: task?.getNextRun()?.toISOString() ?? null };
    });
  }

  /** Starts (or restarts) the cron tasks. */
  async start() {
    await this.scheduler?.stop();
    const stored = (await this.store.list()).filter((schedule) => schedule.enabled);
    const schedules = [
      ...this.uiTests.schedules.map((schedule, index) => ({ ...schedule, id: `config-${index}` })),
      ...stored,
    ];
    this.scheduler = startScheduler(schedules, {
      run: async (schedule) => {
        const entry = this.tests.start(schedule.suite, {
          ...pickRunOptions(schedule),
          trigger: `schedule:${schedule.name ?? schedule.cron}`,
        });
        await entry.done;
      },
    });
    this.active = true;
  }

  async stop() {
    await this.scheduler?.stop();
    this.scheduler = null;
    this.active = false;
  }

  /** Restarts the tasks after a change, if they were running. */
  async reload() {
    if (this.active) await this.start();
  }
}
