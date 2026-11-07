import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { RunHistory, parseConfig } from '@dops/core';
import { buildServer } from '../src/app.js';
import { startServer } from '../src/start.js';

const TOKEN = 'test-token-0123456789';
const auth = { authorization: `Bearer ${TOKEN}` };

const outputRoot = await mkdtemp(join(tmpdir(), 'dops-server-out-'));

const config = parseConfig(`
visual:
  outputDir: ${join(outputRoot, 'visual')}
params:
  branch: { description: Branch, default: main }
  module: { description: Module to enable }
uiTests:
  outputDir: ${join(outputRoot, 'ui-tests')}
  suites:
    smoke:
      testDir: tests/smoke
      baseUrl: 'https://shop.ddev.site'
      environments: { prod: 'https://www.example.com' }
  schedules:
    - { suite: smoke, cron: '0 7 * * 1-5' }
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
  enable:
    targets: [web1]
    steps:
      - { name: Enable, run: 'git checkout {branch} && drush en {module}' }
`);

async function setup({ delayMs = 0, exitCode = 0 } = {}) {
  const history = new RunHistory(await mkdtemp(join(tmpdir(), 'dops-server-')));
  const commands = [];
  const app = buildServer({
    config,
    history,
    token: TOKEN,
    runSuite: async (suite, _options, { outputDir, signal, environment, browser }) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (signal?.aborted) {
        return {
          id: `run-${Date.now()}`,
          suite,
          status: 'cancelled',
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          failures: [],
          reportDir: join(outputDir, suite, 'run-1', 'report'),
        };
      }
      return {
        id: `run-${Date.now()}`,
        suite,
        status: 'passed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        stats: { passed: 3, failed: 0, flaky: 0, skipped: 0, durationMs: 900 },
        failures: [],
        reportDir: join(outputDir, suite, 'run-1', 'report'),
        environment,
        browser,
      };
    },
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
    expect(Object.keys(targets[0]).sort()).toEqual(['environment', 'host', 'name', 'production']);
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

  it('streams run events over a WebSocket', async () => {
    const { app } = await setup({ delayMs: 50 });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address();
    try {
      const started = await app.inject({
        method: 'POST',
        url: '/api/runs',
        headers: auth,
        payload: { pipeline: 'cache-clear', site: 'fr' },
      });
      const { id } = started.json();
      const events = await new Promise((resolve, reject) => {
        const received = [];
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/${id}/events?token=${TOKEN}`);
        ws.on('message', (data) => received.push(JSON.parse(String(data))));
        ws.on('close', () => resolve(received));
        ws.on('error', reject);
      });
      const types = events.map((e) => e.type);
      expect(types[0]).toBe('run-start');
      expect(types).toContain('output');
      expect(types.at(-1)).toBe('run-end');
      expect(events.at(-1).record.status).toBe('ok');
    } finally {
      await app.close();
    }
  });

  it('closes WebSocket connections without the token', async () => {
    const { app } = await setup();
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address();
    try {
      const code = await new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/api/runs/x/events`);
        ws.on('close', (closeCode) => resolve(closeCode));
      });
      expect(code).toBe(1008);
    } finally {
      await app.close();
    }
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

  it('serves the dashboard with a fallback for client-side routes', async () => {
    const staticDir = await mkdtemp(join(tmpdir(), 'dops-web-'));
    await writeFile(join(staticDir, 'index.html'), '<div id="root"></div>');
    const app = buildServer({
      config,
      history: new RunHistory(staticDir),
      token: TOKEN,
      connect: async () => ({}),
      staticDir,
    });
    expect((await app.inject({ url: '/' })).body).toContain('root');
    expect((await app.inject({ url: '/history' })).body).toContain('root');
    expect((await app.inject({ url: '/api/nope', headers: auth })).statusCode).toBe(404);
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

  it('runs an ad-hoc command and records it as a "command" run', async () => {
    const { app, commands, history } = await setup();
    const started = await app.inject({
      method: 'POST',
      url: '/api/commands',
      headers: auth,
      payload: { command: 'drush {alias} status', targets: ['web1'], site: 'fr' },
    });
    expect(started.statusCode).toBe(202);
    await waitFor(async () => (await history.list())[0]);
    expect(commands).toEqual(['web1: drush @fr status']);
    expect((await history.list())[0]?.pipeline).toBe('command');
  });

  it('refuses commands when the dashboard disallows them', async () => {
    const { app } = await setup();
    const locked = buildServer({
      config: { ...config, dashboard: { allowCommands: false } },
      history: new RunHistory(await mkdtemp(join(tmpdir(), 'dops-server-'))),
      token: TOKEN,
      connect: async () => ({ exec: async () => ({ code: 0 }), close: async () => {} }),
    });
    const payload = { command: 'id', targets: ['web1'] };
    const response = await locked.inject({
      method: 'POST',
      url: '/api/commands',
      headers: auth,
      payload,
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('asks for missing parameters and fills them in', async () => {
    const { app, commands, history } = await setup();
    const pipelines = (await app.inject({ url: '/api/pipelines', headers: auth })).json();
    expect(pipelines.find((p) => p.name === 'enable').params).toEqual(['branch', 'module']);
    const params = (await app.inject({ url: '/api/params', headers: auth })).json();
    expect(params[0]).toEqual({
      name: 'branch',
      description: 'Branch',
      default: 'main',
    });

    const start = (payload) =>
      app.inject({ method: 'POST', url: '/api/runs', headers: auth, payload });
    const missing = await start({ pipeline: 'enable' });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().missing).toEqual(['module']);
    expect((await start({ pipeline: 'enable', params: { module: 'a\nb' } })).statusCode).toBe(400);

    expect(
      (await start({ pipeline: 'enable', params: { module: 'admin_toolbar' } })).statusCode,
    ).toBe(202);
    await waitFor(async () => (await history.list())[0]);
    expect(commands).toEqual(['web1: git checkout main && drush en admin_toolbar']);
  });

  it('refuses production targets unless the run is confirmed', async () => {
    const prodConfig = parseConfig(`
targets:
  stage: { host: 10.0.1.1, user: deploy, agent: true }
  prod1: { host: 10.0.2.1, user: deploy, agent: true, production: true }
pipelines:
  status:
    targets: [stage, prod1]
    steps:
      - { name: Status, run: drush status }
`);
    const executed = [];
    const app = buildServer({
      config: prodConfig,
      history: new RunHistory(await mkdtemp(join(tmpdir(), 'dops-server-'))),
      token: TOKEN,
      connect: async (name) => ({
        exec: async (command) => {
          executed.push(`${name}: ${command}`);
          return { code: 0 };
        },
        close: async () => {},
      }),
    });
    const post = (url, payload) => app.inject({ method: 'POST', url, headers: auth, payload });

    const targets = (await app.inject({ url: '/api/targets', headers: auth })).json();
    expect(targets.find((t) => t.name === 'prod1')).toMatchObject({ production: true });
    expect(targets.find((t) => t.name === 'stage')).toMatchObject({ production: false });

    const refused = await post('/api/runs', { pipeline: 'status' });
    expect(refused.statusCode).toBe(428);
    expect(refused.json().production).toEqual(['prod1']);
    const command = await post('/api/commands', { command: 'uptime', targets: ['prod1'] });
    expect(command.statusCode).toBe(428);
    expect(executed).toEqual([]);

    expect((await post('/api/runs', { pipeline: 'status', targets: ['stage'] })).statusCode).toBe(
      202,
    );
    await waitFor(() => executed.length === 1);
    expect(
      (await post('/api/runs', { pipeline: 'status', targets: ['prod1'], confirmProduction: true }))
        .statusCode,
    ).toBe(202);
    await waitFor(() => executed.length === 2);
    expect(executed).toEqual(['stage: drush status', 'prod1: drush status']);
  });

  it('sets a session cookie that also unlocks screenshot files', async () => {
    const { app } = await setup();
    const dir = join(outputRoot, 'visual', 'workspace', 'before');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'a.png'), 'png-bytes');

    expect((await app.inject({ url: '/files/visual/before/a.png' })).statusCode).toBe(401);
    const session = await app.inject({ method: 'POST', url: '/api/session', headers: auth });
    const cookie = String(session.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    const file = await app.inject({
      url: '/files/visual/before/a.png',
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(file.body).toBe('png-bytes');
  });

  it('validates workspace captures and reports an empty comparison', async () => {
    const { app } = await setup();
    const capture = (payload) =>
      app.inject({ method: 'POST', url: '/api/visual/workspace/capture', headers: auth, payload });
    expect((await capture({ phase: 'during', urls: ['https://a.test/'] })).statusCode).toBe(400);
    expect((await capture({ phase: 'before', urls: ['ftp://a.test/'] })).statusCode).toBe(400);
    expect((await capture({ phase: 'before', urls: [] })).statusCode).toBe(400);

    const state = (await app.inject({ url: '/api/visual/workspace', headers: auth })).json();
    expect(state.job).toBeNull();
    const compared = await app.inject({
      method: 'POST',
      url: '/api/visual/workspace/compare',
      headers: auth,
      payload: { start: 0, limit: 20 },
    });
    expect(compared.json()).toMatchObject({ total: 0, done: true, results: [] });
  });

  it('validates page compare lists', async () => {
    const { app } = await setup();
    const start = (payload) =>
      app.inject({ method: 'POST', url: '/api/visual/pairs', headers: auth, payload });
    const uneven = await start({ urlsA: ['https://a.test/'], urlsB: [] });
    expect(uneven.statusCode).toBe(400);
    expect((await start({ urlsA: ['javascript:x'], urlsB: ['https://b.test/'] })).statusCode).toBe(
      400,
    );
    const state = (await app.inject({ url: '/api/visual/pairs', headers: auth })).json();
    expect(state).toEqual({ job: null, result: null });
  });

  it('sets a session cookie that also unlocks the reports', async () => {
    const { app } = await setup();
    await mkdir(join(outputRoot, 'visual', 'shop'), { recursive: true });
    await writeFile(join(outputRoot, 'visual', 'shop', 'report-prod-stage.html'), '<h1>diff</h1>');

    expect(
      (await app.inject({ url: '/reports/visual/shop/report-prod-stage.html' })).statusCode,
    ).toBe(401);
    const session = await app.inject({ method: 'POST', url: '/api/session', headers: auth });
    const cookie = String(session.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    const report = await app.inject({
      url: '/reports/visual/shop/report-prod-stage.html',
      headers: { cookie: cookie.split(';')[0] },
    });
    expect(report.body).toBe('<h1>diff</h1>');

    const reports = (await app.inject({ url: '/api/visual/reports', headers: auth })).json();
    expect(reports[0]).toMatchObject({ set: 'shop', name: 'prod → stage' });
  });

  it('runs a UI test suite in the background and lists it with its report', async () => {
    const { app } = await setup({ delayMs: 50 });
    const suites = (await app.inject({ url: '/api/tests/suites', headers: auth })).json();
    expect(suites).toEqual([
      {
        name: 'smoke',
        baseUrl: 'https://shop.ddev.site',
        environments: { prod: 'https://www.example.com' },
        files: [],
        schedules: ['0 7 * * 1-5'],
        running: false,
      },
    ]);

    const post = (suite) =>
      app.inject({ method: 'POST', url: '/api/tests/runs', headers: auth, payload: { suite } });
    expect((await post('smoke')).statusCode).toBe(202);
    expect((await post('smoke')).statusCode).toBe(409);
    expect((await post('nope')).statusCode).toBe(404);

    const runs = await waitFor(async () => {
      const list = (await app.inject({ url: '/api/tests/runs', headers: auth })).json();
      return list[0]?.status === 'passed' ? list : undefined;
    });
    expect(runs[0].reportUrl).toBe('/reports/ui-tests/smoke/run-1/report/index.html');
  });

  it('runs a suite with options and stops it', async () => {
    const { app } = await setup({ delayMs: 100 });
    const post = (payload) =>
      app.inject({ method: 'POST', url: '/api/tests/runs', headers: auth, payload });
    expect((await post({ suite: 'smoke', environment: 'qa' })).statusCode).toBe(400);
    expect((await post({ suite: 'smoke', browser: 'opera' })).statusCode).toBe(400);
    const started = await post({ suite: 'smoke', environment: 'prod', browser: 'mobile' });
    expect(started.json()).toMatchObject({
      suite: 'smoke',
      environment: 'prod',
      browser: 'mobile',
    });
    const stop = await app.inject({
      method: 'POST',
      url: '/api/tests/runs/smoke/stop',
      headers: auth,
    });
    expect(stop.statusCode).toBe(202);
    const runs = await waitFor(async () => {
      const list = (await app.inject({ url: '/api/tests/runs', headers: auth })).json();
      return list[0]?.status === 'cancelled' ? list : undefined;
    });
    expect(runs[0].status).toBe('cancelled');
  });

  it('manages dashboard schedules next to the config ones', async () => {
    const { app } = await setup();
    const create = (payload) =>
      app.inject({ method: 'POST', url: '/api/tests/schedules', headers: auth, payload });
    expect((await create({ suite: 'smoke', cron: 'often' })).statusCode).toBe(400);
    const created = await create({
      name: 'Nightly',
      suite: 'smoke',
      cron: '0 3 * * *',
      browser: 'firefox',
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json();

    const list = (await app.inject({ url: '/api/tests/schedules', headers: auth })).json();
    expect(list.map((s) => [s.source, s.cron])).toEqual([
      ['config', '0 7 * * 1-5'],
      ['dashboard', '0 3 * * *'],
    ]);
    const toggle = await app.inject({
      method: 'PATCH',
      url: `/api/tests/schedules/${id}`,
      headers: auth,
      payload: { enabled: false },
    });
    expect(toggle.json().enabled).toBe(false);
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/tests/schedules/${id}`,
      headers: auth,
    });
    expect(removed.statusCode).toBe(204);
    const configOne = await app.inject({
      method: 'DELETE',
      url: '/api/tests/schedules/config-0',
      headers: auth,
    });
    expect(configOne.statusCode).toBe(404);
  });
});
