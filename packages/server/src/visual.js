import { VisualWorkspace } from '@dops/visual';
import { join } from 'node:path';
import { RunConflictError } from './runs.js';

/**
 * @import { VisualConfig } from '@dops/core'
 * @import { Phase, WorkspaceCaptureOptions } from '@dops/visual'
 */

/**
 * @typedef {object} CaptureJob
 * @property {Phase} phase
 * @property {'running' | 'done' | 'failed' | 'cancelled'} status
 * @property {number} total
 * @property {{ url: string, status: number, error?: string }[]} pages
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {string} [error]
 */

/**
 * Runs one workspace capture at a time in the background and keeps its
 * progress for the dashboard to poll.
 */
export class VisualJobs {
  /** @param {VisualConfig} visual */
  constructor(visual) {
    this.visual = visual;
    this.workspace = new VisualWorkspace(join(visual.outputDir, 'workspace'));
    /** @type {CaptureJob | null} */
    this.job = null;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  get running() {
    return this.job?.status === 'running';
  }

  /**
   * @param {Phase} phase
   * @param {string[]} urls
   * @param {WorkspaceCaptureOptions} options
   */
  start(phase, urls, options) {
    if (this.running) throw new RunConflictError(`A "${this.job?.phase}" capture is still running`);
    if (!urls.length) throw Object.assign(new Error('Paste at least one URL'), { statusCode: 400 });
    /** @type {CaptureJob} */
    const job = {
      phase,
      status: 'running',
      total: urls.length,
      pages: [],
      startedAt: new Date().toISOString(),
    };
    this.job = job;
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.workspace
      .capture(
        phase,
        urls,
        { hide: this.visual.hide, ...options },
        (page) =>
          job.pages.push({
            url: page.url,
            status: page.status,
            ...(page.error ? { error: page.error } : {}),
          }),
        signal,
      )
      .then(
        () => {
          job.status = signal.aborted ? 'cancelled' : 'done';
        },
        (error) => {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
        },
      )
      .finally(() => {
        job.finishedAt = new Date().toISOString();
      });
    return job;
  }

  cancel() {
    this.controller?.abort();
    return this.running;
  }

  /** @param {{ start: number, limit: number }} page */
  compare({ start, limit }) {
    return this.workspace.compare({
      start,
      limit,
      threshold: this.visual.threshold,
      maxDiffRatio: this.visual.maxDiffRatio,
    });
  }

  async clear() {
    if (this.running) throw new RunConflictError('Wait for the capture to finish');
    await this.workspace.clear();
    this.job = null;
  }
}
