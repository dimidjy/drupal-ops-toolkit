import { createWriteStream } from 'node:fs';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * @import { WriteStream } from 'node:fs'
 * @import { PipelineRunner, RunEvent, RunRecord } from '../pipeline/runner.js'
 */

export const DEFAULT_STATE_DIR = '.dops';

/**
 * @typedef {object} HistoryQuery
 * @property {number} [limit]
 * @property {string} [pipeline]
 */

/**
 * Append-only run history: one JSON line per finished run in history.jsonl and
 * the raw output of each run in logs/<run id>.log.
 */
export class RunHistory {
  /** @param {string} [dir] */
  constructor(dir = DEFAULT_STATE_DIR) {
    this.dir = dir;
    this.file = join(dir, 'history.jsonl');
    this.logDir = join(dir, 'logs');
  }

  /** @param {RunRecord} record */
  async append(record) {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.file, `${JSON.stringify(record)}\n`, 'utf8');
  }

  /**
   * Newest first.
   * @param {HistoryQuery} [query]
   * @returns {Promise<RunRecord[]>}
   */
  async list(query = {}) {
    let content;
    try {
      content = await readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    const records = content
      .split('\n')
      .filter(Boolean)
      .map((line) => /** @type {RunRecord} */ (JSON.parse(line)))
      .filter((record) => !query.pipeline || record.pipeline === query.pipeline)
      .reverse();
    return query.limit ? records.slice(0, query.limit) : records;
  }

  /** @param {string} id */
  async get(id) {
    return (await this.list()).find((record) => record.id === id);
  }

  /** @param {string} id */
  logPath(id) {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) {
      throw new Error(`Invalid run id: ${id}`);
    }
    return join(this.logDir, `${id}.log`);
  }

  /**
   * @param {string} id
   * @returns {Promise<string | undefined>}
   */
  async readLog(id) {
    try {
      return await readFile(this.logPath(id), 'utf8');
    } catch {
      return undefined;
    }
  }

  /**
   * Writes the runner's output to the run log and appends the record when the
   * run ends. Returns a function that detaches and waits for pending writes.
   *
   * @param {PipelineRunner} runner
   * @returns {Promise<() => Promise<void>>}
   */
  async record(runner) {
    await mkdir(this.logDir, { recursive: true });
    /** @type {Map<string, WriteStream>} */
    const logs = new Map();
    /** @type {Promise<unknown>[]} */
    const pending = [];
    /** @param {string} runId */
    const log = (runId) => {
      let stream = logs.get(runId);
      if (!stream) {
        stream = createWriteStream(this.logPath(runId), { flags: 'a' });
        logs.set(runId, stream);
      }
      return stream;
    };
    /** @param {RunEvent} event */
    const listener = (event) => {
      switch (event.type) {
        case 'step-start':
          log(event.runId).write(`\n[${event.target}] $ ${event.command}\n`);
          break;
        case 'output':
          log(event.runId).write(event.text);
          break;
        case 'run-end': {
          const stream = log(event.runId);
          logs.delete(event.runId);
          pending.push(new Promise((resolve) => stream.end(resolve)));
          pending.push(this.append(event.record));
          break;
        }
      }
    };
    runner.on('event', listener);
    return async () => {
      runner.off('event', listener);
      await Promise.all(pending);
    };
  }
}
