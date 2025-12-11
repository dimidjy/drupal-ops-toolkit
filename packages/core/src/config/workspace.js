import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { name, paramName, paramSchema, pipelineSchema } from './schema.js';

/**
 * @import { Config, ParamDefinition, Pipeline } from './schema.js'
 */

export const workspaceSchema = z.object({
  pipelines: z.record(name, pipelineSchema).default({}),
  params: z.record(paramName, paramSchema).default({}),
});

/** @typedef {z.infer<typeof workspaceSchema>} WorkspaceData */

export class WorkspaceError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'WorkspaceError';
    this.statusCode = 400;
  }
}

/**
 * Pipelines and parameters created in the dashboard, kept in a JSON file next
 * to (not inside) the hand-written YAML config. Config entries are read-only;
 * workspace entries are added on top of them.
 */
export class Workspace {
  /**
   * @param {string} file
   * @param {Config} config The loaded YAML config; it is updated in place on every change.
   */
  constructor(file, config) {
    this.file = file;
    this.config = config;
    /** @type {WorkspaceData} */
    this.data = { pipelines: {}, params: {} };
  }

  /**
   * Reads the file and merges its entries into the config.
   *
   * @param {string} file
   * @param {Config} config
   */
  static async open(file, config) {
    const workspace = new Workspace(file, config);
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return workspace;
    }
    const parsed = workspaceSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new WorkspaceError(`Invalid workspace file ${file}`);
    for (const [key, pipeline] of Object.entries(parsed.data.pipelines)) {
      if (!config.pipelines[key]) workspace.#setPipeline(key, pipeline);
    }
    for (const [key, param] of Object.entries(parsed.data.params)) {
      if (!config.params[key]) workspace.#setParam(key, param);
    }
    return workspace;
  }

  /** @param {string} key */
  ownsPipeline(key) {
    return key in this.data.pipelines;
  }

  /** @param {string} key */
  ownsParam(key) {
    return key in this.data.params;
  }

  /**
   * Creates or replaces a dashboard pipeline.
   *
   * @param {string} key
   * @param {unknown} input
   */
  async savePipeline(key, input) {
    const keyCheck = name.safeParse(key);
    if (!keyCheck.success) throw new WorkspaceError(`Invalid pipeline name "${key}"`);
    if (this.config.pipelines[key] && !this.ownsPipeline(key)) {
      throw new WorkspaceError(`"${key}" is defined in the config file and can't be edited here`);
    }
    const parsed = pipelineSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new WorkspaceError(`${issue?.path.join('.') || 'pipeline'}: ${issue?.message}`);
    }
    const unknown = parsed.data.targets.filter((t) => !this.config.targets[t]);
    if (unknown.length) throw new WorkspaceError(`Unknown target "${unknown[0]}"`);
    this.#setPipeline(key, parsed.data);
    await this.#write();
    return parsed.data;
  }

  /** @param {string} key */
  async deletePipeline(key) {
    if (!this.ownsPipeline(key)) throw new WorkspaceError(`"${key}" is not a dashboard pipeline`);
    delete this.data.pipelines[key];
    delete this.config.pipelines[key];
    await this.#write();
  }

  /**
   * @param {string} key
   * @param {unknown} input
   */
  async saveParam(key, input) {
    const keyCheck = paramName.safeParse(key);
    if (!keyCheck.success) throw new WorkspaceError(`Invalid parameter name "${key}"`);
    if (this.config.params[key] && !this.ownsParam(key)) {
      throw new WorkspaceError(`"${key}" is defined in the config file and can't be edited here`);
    }
    const parsed = paramSchema.safeParse(input);
    if (!parsed.success) throw new WorkspaceError('Invalid parameter');
    this.#setParam(key, parsed.data);
    await this.#write();
    return parsed.data;
  }

  /** @param {string} key */
  async deleteParam(key) {
    if (!this.ownsParam(key)) throw new WorkspaceError(`"${key}" is not a dashboard parameter`);
    delete this.data.params[key];
    delete this.config.params[key];
    await this.#write();
  }

  /**
   * @param {string} key
   * @param {Pipeline} pipeline
   */
  #setPipeline(key, pipeline) {
    this.data.pipelines[key] = pipeline;
    this.config.pipelines[key] = pipeline;
  }

  /**
   * @param {string} key
   * @param {ParamDefinition} param
   */
  #setParam(key, param) {
    this.data.params[key] = param;
    this.config.params[key] = param;
  }

  async #write() {
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.data, null, 2)}\n`);
    await rename(temporary, this.file);
  }
}
