import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { renderTemplate } from './placeholders.js';

/**
 * @import { Pipeline, Target } from '../config/schema.js'
 * @import { CommandExecutor } from '../ssh/executor.js'
 * @import { Params } from './placeholders.js'
 */

/** @typedef {'ok' | 'failed' | 'skipped'} StepStatus */
/** @typedef {'ok' | 'failed' | 'cancelled'} RunStatus */

/**
 * @typedef {object} StepRecord
 * @property {string} target
 * @property {string} name
 * @property {string} command
 * @property {StepStatus} status
 * @property {number} [code]
 * @property {number} durationMs
 */

/**
 * @typedef {object} RunRecord
 * @property {string} id
 * @property {string} pipeline
 * @property {string} [site]
 * @property {Params} [params]
 * @property {string[]} targets
 * @property {RunStatus} status
 * @property {string} startedAt
 * @property {string} finishedAt
 * @property {StepRecord[]} steps
 */

/**
 * @typedef {{ type: 'run-start', runId: string, pipeline: string, targets: string[] }
 *   | { type: 'step-start', runId: string, target: string, index: number, name: string, command: string }
 *   | { type: 'output', runId: string, target: string, index: number, stream: 'stdout' | 'stderr', text: string }
 *   | { type: 'step-end', runId: string, target: string, index: number, step: StepRecord }
 *   | { type: 'run-end', runId: string, record: RunRecord }} RunEvent
 */

/**
 * @typedef {object} RunOptions
 * @property {string} pipelineName
 * @property {Pipeline} pipeline
 * @property {Record<string, Target>} targets Targets to run on, in order.
 * @property {{ name: string, params: Params }} [site]
 * @property {Params} [defaults] Parameter defaults, overridden by the site.
 * @property {Params} [params] Values given for this run; they win over everything.
 * @property {(targetName: string, target: Target) => Promise<CommandExecutor>} connect
 *   Opens an executor for a target: SSH in production, a fake in tests.
 * @property {AbortSignal} [signal]
 * @property {string} [runId]
 */

/**
 * Runs a pipeline target by target and reports progress as `event` emissions.
 *
 * @extends {EventEmitter<{ event: [RunEvent] }>}
 */
export class PipelineRunner extends EventEmitter {
  /**
   * @param {RunOptions} options
   * @returns {Promise<RunRecord>}
   */
  async run(options) {
    const runId = options.runId ?? randomUUID();
    const targetNames = Object.keys(options.targets);
    const startedAt = new Date().toISOString();
    /** @type {StepRecord[]} */
    const steps = [];
    /** @type {RunStatus} */
    let status = 'ok';

    this.emit('event', {
      type: 'run-start',
      runId,
      pipeline: options.pipelineName,
      targets: targetNames,
    });

    for (const [targetName, target] of Object.entries(options.targets)) {
      /** @type {Params} */
      const params = {
        target: targetName,
        environment: target.environment ?? targetName,
        path: target.path,
        ...options.defaults,
        ...(options.site ? { site: options.site.name, ...options.site.params } : {}),
        ...options.params,
      };
      // Render everything up front: a typo in step 3 must not leave step 1 half-applied.
      const commands = options.pipeline.steps.map((step) => renderTemplate(step.run, params));

      if (status !== 'ok') {
        options.pipeline.steps.forEach((step, index) =>
          steps.push(this.#skip(runId, targetName, index, step.name, String(commands[index]))),
        );
        continue;
      }

      const executor = await options.connect(targetName, target);
      try {
        for (const [index, step] of options.pipeline.steps.entries()) {
          const command = String(commands[index]);
          if (status !== 'ok' || options.signal?.aborted) {
            if (options.signal?.aborted) status = 'cancelled';
            steps.push(this.#skip(runId, targetName, index, step.name, command));
            continue;
          }
          this.emit('event', {
            type: 'step-start',
            runId,
            target: targetName,
            index,
            name: step.name,
            command,
          });
          const started = Date.now();
          let code;
          try {
            ({ code } = await executor.exec(command, {
              cwd: target.path,
              timeoutMs: step.timeoutSeconds * 1000,
              signal: options.signal,
              onStdout: (text) => this.#output(runId, targetName, index, 'stdout', text),
              onStderr: (text) => this.#output(runId, targetName, index, 'stderr', text),
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.#output(runId, targetName, index, 'stderr', `${message}\n`);
            code = 255;
          }
          /** @type {StepRecord} */
          const record = {
            target: targetName,
            name: step.name,
            command,
            status: code === 0 ? 'ok' : 'failed',
            code,
            durationMs: Date.now() - started,
          };
          steps.push(record);
          this.emit('event', { type: 'step-end', runId, target: targetName, index, step: record });
          if (code !== 0 && !step.continueOnError) {
            status = 'failed';
          }
        }
      } finally {
        await executor.close();
      }
    }

    /** @type {RunRecord} */
    const record = {
      id: runId,
      pipeline: options.pipelineName,
      ...(options.site ? { site: options.site.name } : {}),
      ...(options.params && Object.keys(options.params).length ? { params: options.params } : {}),
      targets: targetNames,
      status,
      startedAt,
      finishedAt: new Date().toISOString(),
      steps,
    };
    this.emit('event', { type: 'run-end', runId, record });
    return record;
  }

  /**
   * @param {string} runId
   * @param {string} target
   * @param {number} index
   * @param {'stdout' | 'stderr'} stream
   * @param {string} text
   */
  #output(runId, target, index, stream, text) {
    this.emit('event', { type: 'output', runId, target, index, stream, text });
  }

  /**
   * @param {string} runId
   * @param {string} target
   * @param {number} index
   * @param {string} name
   * @param {string} command
   * @returns {StepRecord}
   */
  #skip(runId, target, index, name, command) {
    /** @type {StepRecord} */
    const step = { target, name, command, status: 'skipped', durationMs: 0 };
    this.emit('event', { type: 'step-end', runId, target, index, step });
    return step;
  }
}
