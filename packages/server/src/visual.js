import { rm, readFile } from 'node:fs/promises';
import { VisualWorkspace, comparePairs } from '@dops/visual';
import { join } from 'node:path';
import { RunConflictError } from './runs.js';

/**
 * @import { VisualConfig } from '@dops/core'
 * @import { Phase, Side, WorkspaceCaptureOptions } from '@dops/visual'
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
        { hide: this.visual.hide, concurrency: this.visual.concurrency, ...options },
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

/**
 * @typedef {object} PairsJob
 * @property {'running' | 'done' | 'failed' | 'cancelled'} status
 * @property {number} total Pages to capture on both sides.
 * @property {number} captured
 * @property {{ side: 'A' | 'B', url: string, error: string }[]} errors
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {string} [error]
 */

/**
 * Page compare: list A against list B, one job at a time; only the latest
 * result is kept.
 */
export class PairJobs {
  /** @param {VisualConfig} visual */
  constructor(visual) {
    this.visual = visual;
    this.dir = join(visual.outputDir, 'pairs');
    /** @type {PairsJob | null} */
    this.job = null;
    /** @type {AbortController | null} */
    this.controller = null;
  }

  get running() {
    return this.job?.status === 'running';
  }

  /**
   * @param {{ urlsA: string[], urlsB: string[], capture: WorkspaceCaptureOptions, sideA: Side, sideB: Side }} request
   */
  start({ urlsA, urlsB, capture, sideA, sideB }) {
    if (this.running) throw new RunConflictError('A page compare is still running');
    if (!urlsA.length || urlsA.length !== urlsB.length) {
      throw Object.assign(new Error('Both lists need the same number of URLs'), {
        statusCode: 400,
      });
    }
    /** @type {PairsJob} */
    const job = {
      status: 'running',
      total: urlsA.length * 2,
      captured: 0,
      errors: [],
      startedAt: new Date().toISOString(),
    };
    this.job = job;
    this.controller = new AbortController();
    const { signal } = this.controller;
    rm(this.dir, { recursive: true, force: true })
      .then(() =>
        comparePairs({
          urlsA,
          urlsB,
          outDir: this.dir,
          threshold: this.visual.threshold,
          capture: { hide: this.visual.hide, concurrency: this.visual.concurrency, ...capture },
          sideA,
          sideB,
          signal,
          onPage: (side, page) => {
            job.captured++;
            if (page.error) job.errors.push({ side, url: page.url, error: page.error });
          },
        }),
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

  /** The latest result, with image URLs under /files/pairs/. */
  async result() {
    try {
      const saved = JSON.parse(await readFile(join(this.dir, 'result.json'), 'utf8'));
      /** @param {string | undefined} file */
      const url = (file) =>
        file ? `/files/pairs/${file}?v=${Date.parse(saved.createdAt)}` : undefined;
      return {
        createdAt: saved.createdAt,
        results: saved.results.map((/** @type {import('@dops/visual').PairResult} */ item) => ({
          ...item,
          imageA: url(item.fileA),
          imageB: url(item.fileB),
          diffImage: url(item.diffFile),
        })),
      };
    } catch {
      return null;
    }
  }

  async clear() {
    if (this.running) throw new RunConflictError('Wait for the page compare to finish');
    await rm(this.dir, { recursive: true, force: true });
    this.job = null;
  }
}
