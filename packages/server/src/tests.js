import { EventEmitter } from 'node:events';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { TestHistory, notifyRun, runSuite as defaultRunSuite } from '@dops/ui-tests';
import { RunConflictError } from './runs.js';

/**
 * @import { UiTestsConfig } from '@dops/core'
 * @import { UiTestRun } from '@dops/ui-tests'
 */

/**
 * Starts UI test suites in the background, one run per suite at a time.
 * Emits "finished" with the run once it is stored.
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
    /** @type {Map<string, { suite: string, startedAt: string }>} */
    this.active = new Map();
  }

  /** @param {string} name */
  start(name) {
    const suite = this.uiTests.suites[name];
    if (!suite) throw new Error(`Unknown suite "${name}"`);
    if (this.active.has(name)) throw new RunConflictError(`Suite "${name}" is already running`);
    const entry = { suite: name, startedAt: new Date().toISOString() };
    this.active.set(name, entry);
    void this.#run(name, suite);
    return entry;
  }

  /**
   * @param {string} name
   * @param {import('@dops/core').UiSuite} suite
   */
  async #run(name, suite) {
    try {
      const run = await this.runSuite(name, suite, { outputDir: this.uiTests.outputDir });
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
