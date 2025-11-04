import { describe, expect, it } from 'vitest';
import { PlaceholderError, renderTemplate } from '../src/pipeline/placeholders.js';
import { PipelineRunner } from '../src/pipeline/runner.js';

/** In-memory executor that records commands and returns configured exit codes. */
class FakeExecutor {
  constructor(exitCodes = {}) {
    this.exitCodes = exitCodes;
    this.commands = [];
    this.closed = false;
  }
  async exec(command, options = {}) {
    this.commands.push({ command, cwd: options.cwd });
    options.onStdout?.(`ran ${command}\n`);
    return { code: this.exitCodes[command] ?? 0 };
  }
  async close() {
    this.closed = true;
  }
}

const target = (host) => ({
  host,
  port: 22,
  user: 'deploy',
  agent: true,
  path: '/var/www/site',
  environment: 'staging',
});

const pipeline = {
  targets: ['web1', 'web2'],
  steps: [
    { name: 'Pull', run: 'git pull', continueOnError: false, timeoutSeconds: 60 },
    { name: 'Cache', run: 'drush {alias} cr', continueOnError: false, timeoutSeconds: 60 },
  ],
};

describe('renderTemplate', () => {
  it('fills placeholders and leaves shell expansions alone', () => {
    expect(renderTemplate('drush {alias} cr && echo ${HOME}', { alias: '@fr' })).toBe(
      'drush @fr cr && echo ${HOME}',
    );
  });

  it('rejects unknown placeholders', () => {
    expect(() => renderTemplate('drush {alais} cr', { alias: '@fr' })).toThrow(PlaceholderError);
  });
});

describe('PipelineRunner', () => {
  it('runs every step on every target and records the result', async () => {
    const executors = {};
    const events = [];
    const runner = new PipelineRunner();
    runner.on('event', (event) => events.push(event));

    const record = await runner.run({
      pipelineName: 'deploy',
      pipeline,
      targets: { web1: target('10.0.0.1'), web2: target('10.0.0.2') },
      site: { name: 'fr', params: { alias: '@fr' } },
      connect: async (name) => (executors[name] = new FakeExecutor()),
    });

    expect(record.status).toBe('ok');
    expect(record.site).toBe('fr');
    expect(executors.web1.commands).toEqual([
      { command: 'git pull', cwd: '/var/www/site' },
      { command: 'drush @fr cr', cwd: '/var/www/site' },
    ]);
    expect(executors.web2.closed).toBe(true);
    expect(events[0].type).toBe('run-start');
    expect(events.at(-1).type).toBe('run-end');
    expect(events.filter((e) => e.type === 'output')).toHaveLength(4);
  });

  it('stops after a failed step and skips the remaining targets', async () => {
    const record = await new PipelineRunner().run({
      pipelineName: 'deploy',
      pipeline,
      targets: { web1: target('10.0.0.1'), web2: target('10.0.0.2') },
      site: { name: 'fr', params: { alias: '@fr' } },
      connect: async () => new FakeExecutor({ 'git pull': 1 }),
    });

    expect(record.status).toBe('failed');
    expect(record.steps.map((s) => `${s.target}:${s.name}:${s.status}`)).toEqual([
      'web1:Pull:failed',
      'web1:Cache:skipped',
      'web2:Pull:skipped',
      'web2:Cache:skipped',
    ]);
  });

  it('continues when a step allows failure', async () => {
    const tolerant = {
      ...pipeline,
      targets: ['web1'],
      steps: pipeline.steps.map((s, i) => (i === 0 ? { ...s, continueOnError: true } : s)),
    };
    const record = await new PipelineRunner().run({
      pipelineName: 'deploy',
      pipeline: tolerant,
      targets: { web1: target('10.0.0.1') },
      site: { name: 'fr', params: { alias: '@fr' } },
      connect: async () => new FakeExecutor({ 'git pull': 1 }),
    });
    expect(record.status).toBe('ok');
    expect(record.steps.map((s) => s.status)).toEqual(['failed', 'ok']);
  });

  it('validates placeholders before touching any target', async () => {
    let connected = false;
    await expect(
      new PipelineRunner().run({
        pipelineName: 'deploy',
        pipeline,
        targets: { web1: target('10.0.0.1') },
        connect: async () => {
          connected = true;
          return new FakeExecutor();
        },
      }),
    ).rejects.toThrow(/alias/);
    expect(connected).toBe(false);
  });
});
