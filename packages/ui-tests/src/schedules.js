import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isValidCron } from './scheduler.js';

/**
 * @import { UiRunOptions, UiSchedule, UiTestsConfig } from '@dops/core'
 */

/**
 * @typedef {UiSchedule & { id: string, enabled: boolean }} StoredSchedule
 */

/** Where the dashboard keeps its schedules. @param {UiTestsConfig} uiTests */
export function scheduleFile(uiTests) {
  return join(uiTests.outputDir, 'schedules.json');
}

/**
 * The run options of a schedule (test file, environment, URLs, browser).
 *
 * @param {UiRunOptions} schedule
 * @returns {UiRunOptions}
 */
export function pickRunOptions(schedule) {
  return {
    ...(schedule.testFile ? { testFile: schedule.testFile } : {}),
    ...(schedule.environment ? { environment: schedule.environment } : {}),
    ...(schedule.urls?.length ? { urls: schedule.urls } : {}),
    ...(schedule.browser ? { browser: schedule.browser } : {}),
  };
}

/**
 * Schedules created in the dashboard, next to the ones in the config file.
 */
export class ScheduleStore {
  /** @param {string} file */
  constructor(file) {
    this.file = file;
  }

  /** @returns {Promise<StoredSchedule[]>} */
  async list() {
    try {
      return JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      return [];
    }
  }

  /**
   * @param {UiTestsConfig} uiTests
   * @param {Omit<StoredSchedule, 'id' | 'enabled'> & { enabled?: boolean }} input
   */
  async add(uiTests, input) {
    const suite = uiTests.suites[input.suite];
    if (!suite)
      throw Object.assign(new Error(`Unknown suite "${input.suite}"`), { statusCode: 400 });
    if (!isValidCron(input.cron)) {
      throw Object.assign(new Error(`Invalid cron expression "${input.cron}"`), {
        statusCode: 400,
      });
    }
    if (input.environment && !suite.environments[input.environment]) {
      throw Object.assign(new Error(`Unknown environment "${input.environment}"`), {
        statusCode: 400,
      });
    }
    /** @type {StoredSchedule} */
    const schedule = { ...input, id: randomUUID(), enabled: input.enabled ?? true };
    await this.#write([...(await this.list()), schedule]);
    return schedule;
  }

  /**
   * @param {string} id
   * @param {{ enabled: boolean }} patch
   */
  async update(id, patch) {
    const all = await this.list();
    const schedule = all.find((s) => s.id === id);
    if (!schedule) return undefined;
    schedule.enabled = patch.enabled;
    await this.#write(all);
    return schedule;
  }

  /** @param {string} id */
  async remove(id) {
    const all = await this.list();
    const rest = all.filter((s) => s.id !== id);
    await this.#write(rest);
    return rest.length !== all.length;
  }

  /** @param {StoredSchedule[]} schedules */
  async #write(schedules) {
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(`${this.file}.tmp`, `${JSON.stringify(schedules, null, 2)}\n`);
    await rename(`${this.file}.tmp`, this.file);
  }
}
