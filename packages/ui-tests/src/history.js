import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** @import { UiTestRun } from './runner.js' */

/** UI test runs as JSON Lines, newest last on disk. */
export class TestHistory {
  /** @param {string} dir */
  constructor(dir) {
    this.file = join(dir, 'history.jsonl');
    this.dir = dir;
  }

  /** @param {UiTestRun} run */
  async append(run) {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, `${JSON.stringify(run)}\n`);
  }

  /**
   * @param {{ suite?: string, limit?: number }} [filter]
   * @returns {Promise<UiTestRun[]>} newest first
   */
  async list({ suite, limit = 20 } = {}) {
    let text;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => /** @type {UiTestRun} */ (JSON.parse(line)))
      .filter((run) => !suite || run.suite === suite)
      .reverse()
      .slice(0, limit);
  }

  /** @param {string} id */
  async get(id) {
    return (await this.list({ limit: Infinity })).find((run) => run.id === id);
  }
}
