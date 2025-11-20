import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RunHistory, parseConfig } from '@dops/core';
import { buildServer } from '../src/app.js';
import { startServer } from '../src/start.js';

const TOKEN = 'test-token-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };

const config = parseConfig(`
sites:
  fr: { alias: '@fr' }
targets:
  web1: { host: 10.0.0.1, user: deploy, agent: true }
  web2: { host: 10.0.0.2, user: deploy, agent: true }
pipelines:
  cache-clear:
    targets: [web1, web2]
    steps:
      - { name: Cache, run: 'drush {alias} cr' }
`);

async function setup({ delayMs = 0, exitCode = 0 } = {}) {
  const history = new RunHistory(await mkdtemp(join(tmpdir(), 'dops-server-')));
  const commands = [];
  const app = buildServer({
    config,
    history,
    token: TOKEN,
    connect: async (name) => ({
      exec: async (command, options) => {
        commands.push(`${name}: ${command}`);
        options?.onStdout?.('done\n');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return { code: exitCode };
      },
      close: async () => {},
    }),
  });
  return { app, history, commands };
}

const waitFor = async (check) => {
  for (let i = 0; i < 100; i++) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out');
};

describe('dashboard API', () => {
  it('requires the bearer token', async () => {
    const { app } = await setup();
    expect((await app.inject({ url: '/api/pipelines' })).statusCode).toBe(401);
    const wrong = { authorization: 'Bearer wrong-token-0123456789' };
    expect((await app.inject({ url: '/api/pipelines', headers: wrong })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/pipelines', headers: auth })).statusCode).toBe(200);
  });

  it('lists pipelines without exposing credentials', async () => {
    const { app } = await setup();
    const pipelines = (await app.inject({ url: '/api/pipelines', headers: auth })).json();
    expect(pipelines[0]).toMatchObject({ name: 'cache-clear', targets: ['web1', 'web2'] });
    const targets = (await app.inject({ url: '/api/targets', headers: auth })).json();
    expect(Object.keys(targets[0]).sort()).toEqual(['environment', 'host', 'name']);
  });

  it('starts a run, records it and serves the log', async () => {
    const { app, commands } = await setup();
    const started = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: auth,
      payload: { pipeline: 'cache-clear', site: 'fr', targets: ['web2'] },
    });
    expect(started.statusCode).toBe(202);
    const { id } = started.json();
    const record = await waitFor(async () => {
      const res = (await app.inject({ url: `/api/runs/${id}`, headers: auth })).json();
      return res.status !== 'running' && res;
    });
    expect(record.status).toBe('ok');
    expect(commands).toEqual(['web2: drush @fr cr']);
    const log = await app.inject({ url: `/api/runs/${id}/log`, headers: auth });
    expect(log.body).toContain('drush @fr cr');
  });

  it('refuses a second run on a busy target', async () => {
    const { app } = await setup({ delayMs: 100 });
    const payload = { pipeline: 'cache-clear', site: 'fr' };
    const first = await app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload });
    expect(first.statusCode).toBe(202);
    const second = await app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload });
    expect(second.statusCode).toBe(409);
  });

  it('rejects unknown pipelines and unexpected fields', async () => {
    const { app } = await setup();
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: auth,
      payload: { pipeline: 'nope' },
    });
    expect(unknown.statusCode).toBe(404);
    const adHoc = await app.inject({
      method: 'POST',
      url: '/api/runs',
      headers: auth,
      payload: { pipeline: 'cache-clear', command: 'rm -rf /' },
    });
    expect(adHoc.statusCode).toBe(400);
  });

  it('refuses to listen on a public interface by default', async () => {
    await expect(
      startServer({ configFile: 'unused.yml', host: '0.0.0.0', env: {} }),
    ).rejects.toThrow(/Refusing to listen on 0.0.0.0/);
  });

  it('rejects short tokens', () => {
    expect(() =>
      buildServer({
        config,
        history: new RunHistory('/tmp/x'),
        connect: async () => ({}),
        token: 'short',
      }),
    ).toThrow(/at least 16/);
  });
});
