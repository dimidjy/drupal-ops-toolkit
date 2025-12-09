import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PipelineRunner } from '@dops/core';

/**
 * @import { Config, Target, CommandExecutor, Pipeline, RunEvent, RunHistory, RunRecord } from '@dops/core'
 */

export class RunConflictError extends Error {
  /** @param {string[]} targets */
  constructor(targets) {
    super(`A run is already in progress on ${targets.join(', ')}`);
    this.name = 'RunConflictError';
  }
}

/**
 * @typedef {object} ActiveRun
 * @property {string} id
 * @property {string} pipeline
 * @property {string[]} targets
 * @property {RunEvent[]} events Everything emitted so far, replayed to late subscribers.
 * @property {AbortController} controller
 */

/**
 * Starts pipeline runs in the background, keeps their events for streaming and
 * allows at most one run per target at a time.
 *
 * @extends {EventEmitter<{ event: [RunEvent] }>}
 */
export class RunManager extends EventEmitter {
  /**
   * @param {object} options
   * @param {Config} options.config
   * @param {RunHistory} options.history
   * @param {(name: string, target: Target) => Promise<CommandExecutor>} options.connect
   */
  constructor({ config, history, connect }) {
    super();
    this.config = config;
    this.history = history;
    this.connect = connect;
    /** @type {Map<string, ActiveRun>} */
    this.active = new Map();
  }

  /**
   * @param {object} request
   * @param {string} request.pipeline
   * @param {string[]} [request.targets]
   * @param {string} [request.site]
   * @returns {Promise<{ id: string, done: Promise<RunRecord> }>}
   */
  async start(request) {
    const pipeline = this.config.pipelines[request.pipeline];
    if (!pipeline) throw new Error(`Unknown pipeline "${request.pipeline}"`);
    return this.#launch(request.pipeline, pipeline, request);
  }

  /**
   * Runs one ad-hoc shell command on the given targets, recorded like a pipeline
   * run named "command".
   *
   * @param {object} request
   * @param {string} request.command
   * @param {string[]} request.targets
   * @param {string} [request.site]
   */
  async command(request) {
    if (!request.command.trim()) throw new Error('Empty command');
    if (!request.targets.length) throw new Error('Choose at least one target');
    /** @type {Pipeline} */
    const pipeline = {
      targets: request.targets,
      steps: [
        {
          name: request.command,
          run: request.command,
          continueOnError: true,
          timeoutSeconds: 1800,
        },
      ],
    };
    return this.#launch('command', pipeline, request);
  }

  /**
   * @param {string} pipelineName
   * @param {Pipeline} pipeline
   * @param {{ targets?: string[], site?: string }} request
   * @returns {Promise<{ id: string, done: Promise<RunRecord> }>}
   */
  async #launch(pipelineName, pipeline, request) {
    const targetNames = request.targets?.length ? request.targets : pipeline.targets;

    /** @type {Record<string, Target>} */
    const targets = {};
    for (const name of targetNames) {
      const target = this.config.targets[name];
      if (!target) throw new Error(`Unknown target "${name}"`);
      targets[name] = target;
    }
    const busy = targetNames.filter((name) =>
      [...this.active.values()].some((run) => run.targets.includes(name)),
    );
    if (busy.length) throw new RunConflictError(busy);

    let site;
    if (request.site) {
      const params = this.config.sites[request.site];
      if (!params) throw new Error(`Unknown site "${request.site}"`);
      site = { name: request.site, params };
    }

    const id = randomUUID();
    /** @type {ActiveRun} */
    const run = {
      id,
      pipeline: pipelineName,
      targets: targetNames,
      events: [],
      controller: new AbortController(),
    };
    this.active.set(id, run);

    const runner = new PipelineRunner();
    runner.on('event', (event) => {
      run.events.push(event);
      this.emit('event', event);
    });
    const stopRecording = await this.history.record(runner);
    const done = runner
      .run({
        runId: id,
        pipelineName,
        pipeline,
        targets,
        ...(site ? { site } : {}),
        connect: this.connect,
        signal: run.controller.signal,
      })
      .finally(async () => {
        await stopRecording();
        this.active.delete(id);
      });
    // Errors are reported through events and history; keep the process alive.
    done.catch(() => {});
    return { id, done };
  }

  /** @param {string} id */
  cancel(id) {
    const run = this.active.get(id);
    run?.controller.abort();
    return Boolean(run);
  }
}
