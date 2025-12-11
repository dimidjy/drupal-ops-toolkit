import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Workspace, parseConfig } from '../src/index.js';

const yaml = `
targets:
  web1: { host: 10.0.0.1, user: deploy, agent: true }
params:
  branch: { default: main }
pipelines:
  cache-clear:
    targets: [web1]
    steps: [{ name: Cache, run: drush cr }]
`;

describe('Workspace', () => {
  it('adds dashboard pipelines and params to the config and persists them', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dops-ws-')), 'workspace.json');
    const config = parseConfig(yaml);
    const workspace = await Workspace.open(file, config);

    await workspace.savePipeline('status', {
      targets: ['web1'],
      steps: [{ name: 'Status', run: 'drush status' }],
    });
    await workspace.saveParam('ticket', { description: 'Jira key' });

    expect(config.pipelines.status?.steps[0]).toMatchObject({
      run: 'drush status',
      timeoutSeconds: 600,
    });
    expect(config.params.ticket).toEqual({ description: 'Jira key' });

    const reopened = parseConfig(yaml);
    await Workspace.open(file, reopened);
    expect(Object.keys(reopened.pipelines)).toEqual(['cache-clear', 'status']);
    expect(JSON.parse(await readFile(file, 'utf8')).params.ticket.description).toBe('Jira key');

    await workspace.deletePipeline('status');
    expect(config.pipelines.status).toBeUndefined();
  });

  it('protects config entries and validates input', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dops-ws-')), 'workspace.json');
    const workspace = await Workspace.open(file, parseConfig(yaml));
    const step = { name: 'x', run: 'x' };
    await expect(
      workspace.savePipeline('cache-clear', { targets: ['web1'], steps: [step] }),
    ).rejects.toThrow(/config file/);
    await expect(workspace.savePipeline('x', { targets: ['nope'], steps: [step] })).rejects.toThrow(
      /Unknown target/,
    );
    await expect(workspace.savePipeline('x', { targets: ['web1'], steps: [] })).rejects.toThrow(
      /steps/,
    );
    await expect(
      workspace.savePipeline('Bad Name', { targets: ['web1'], steps: [step] }),
    ).rejects.toThrow(/Invalid pipeline name/);
    await expect(workspace.deleteParam('branch')).rejects.toThrow(/not a dashboard parameter/);
  });
});
