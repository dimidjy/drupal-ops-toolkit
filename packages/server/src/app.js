import { timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { Workspace, isLocalTarget, pipelineParams } from '@dops/core';
import { MissingParamsError, RunConflictError, RunManager } from './runs.js';
import { AiService } from './ai.js';
import { VisualJobs } from './visual.js';

/**
 * @import { Config, Target, CommandExecutor, RunHistory } from '@dops/core'
 * @import { FastifyRequest } from 'fastify'
 */

/**
 * @typedef {object} ServerOptions
 * @property {Config} config
 * @property {RunHistory} history
 * @property {(name: string, target: Target) => Promise<CommandExecutor>} connect
 * @property {string} token Bearer token required on every /api request.
 * @property {boolean | object} [logger]
 * @property {string} [staticDir] Built dashboard to serve on /, if present.
 * @property {Workspace} [workspace] Dashboard-made pipelines and parameters.
 * @property {AiService} [ai] Commit reviews through dops-ai; injectable for tests.
 */

/**
 * @param {string} given
 * @param {string} expected
 */
function sameToken(given, expected) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const COOKIE = 'dops_token';

/** @param {FastifyRequest} request */
function requestToken(request) {
  const header = request.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  // Set by POST /api/session so that plain links and <img> tags are authenticated too.
  const cookie = (request.headers.cookie ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`));
  if (cookie) return cookie.slice(COOKIE.length + 1);
  // Browsers cannot set headers on WebSocket connections.
  const query = /** @type {{ token?: string }} */ (request.query);
  return query.token ?? '';
}

/** @param {ServerOptions} options */
export function buildServer({
  config,
  history,
  connect,
  token,
  logger = false,
  staticDir,
  workspace = new Workspace(config.dashboard.workspaceFile, config),
  ai = new AiService(config),
}) {
  if (!token || token.length < 16) {
    throw new Error('A token of at least 16 characters is required');
  }
  const app = Fastify({
    logger,
    // Reject unexpected body fields instead of silently dropping them.
    ajv: { customOptions: { removeAdditional: false } },
    // Close open sockets (e.g. dashboards) on shutdown instead of waiting.
    forceCloseConnections: true,
  });
  const runs = new RunManager({ config, history, connect });
  app.decorate('runs', runs);

  app.addHook('onRequest', async (request, reply) => {
    // WebSocket upgrades authenticate in their handler: a rejected upgrade socket
    // is not tracked by the HTTP server and would block shutdown.
    if (request.headers.upgrade === 'websocket') return;
    const protectedPath = request.url.startsWith('/api/') || request.url.startsWith('/files/');
    if (protectedPath && !sameToken(requestToken(request), token)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.setErrorHandler((/** @type {import('fastify').FastifyError} */ error, _request, reply) => {
    if (error instanceof RunConflictError) {
      return reply.code(409).send({ error: error.message });
    }
    if (error instanceof MissingParamsError) {
      return reply.code(400).send({ error: error.message, missing: error.missing });
    }
    const status = error.statusCode ?? (/^Unknown /.test(error.message) ? 404 : 500);
    return reply.code(status).send({ error: error.message });
  });

  app.register(websocket);
  app.register(async (scoped) => {
    // Replays what already happened, then streams live events until the run ends.
    scoped.get('/api/runs/:id/events', { websocket: true }, async (socket, request) => {
      if (!sameToken(requestToken(request), token)) {
        socket.close(1008, 'Unauthorized');
        return;
      }
      const { id } = /** @type {{ id: string }} */ (request.params);
      const active = runs.active.get(id);
      if (!active) {
        const record = await history.get(id);
        socket.send(
          JSON.stringify(
            record ? { type: 'run-end', runId: id, record } : { type: 'unknown-run', runId: id },
          ),
        );
        socket.close();
        return;
      }
      for (const event of active.events) socket.send(JSON.stringify(event));
      /** @param {import('@dops/core').RunEvent} event */
      const forward = (event) => {
        if (event.runId !== id) return;
        socket.send(JSON.stringify(event));
        if (event.type === 'run-end') socket.close();
      };
      runs.on('event', forward);
      socket.on('close', () => runs.off('event', forward));
    });
  });

  app.post('/api/session', async (_request, reply) =>
    reply
      .header('set-cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict`)
      .code(204)
      .send(),
  );

  app.delete('/api/session', async (_request, reply) =>
    reply.header('set-cookie', `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`).code(204).send(),
  );

  app.get('/api/pipelines', async () =>
    Object.entries(config.pipelines).map(([name, pipeline]) => ({
      name,
      description: pipeline.description ?? null,
      targets: pipeline.targets,
      steps: pipeline.steps,
      params: pipelineParams(pipeline),
      source: workspace.ownsPipeline(name) ? 'dashboard' : 'config',
    })),
  );

  app.put('/api/pipelines/:name', async (request) => {
    const { name } = /** @type {{ name: string }} */ (request.params);
    const pipeline = await workspace.savePipeline(name, request.body);
    return { name, ...pipeline };
  });

  app.delete('/api/pipelines/:name', async (request, reply) => {
    const { name } = /** @type {{ name: string }} */ (request.params);
    await workspace.deletePipeline(name);
    return reply.code(204).send();
  });

  app.put('/api/params/:name', async (request) => {
    const { name } = /** @type {{ name: string }} */ (request.params);
    return { name, ...(await workspace.saveParam(name, request.body)) };
  });

  app.delete('/api/params/:name', async (request, reply) => {
    const { name } = /** @type {{ name: string }} */ (request.params);
    await workspace.deleteParam(name);
    return reply.code(204).send();
  });

  app.get('/api/params', async () =>
    Object.entries(config.params).map(([name, param]) => ({
      name,
      description: param.description ?? null,
      default: param.default ?? null,
      source: workspace.ownsParam(name) ? 'dashboard' : 'config',
    })),
  );

  // Which {placeholders} each site fills in, so the dashboard only asks for the rest.
  app.get('/api/site-params', async () =>
    Object.fromEntries(
      Object.entries(config.sites).map(([name, params]) => [name, Object.keys(params)]),
    ),
  );

  app.get('/api/targets', async () =>
    Object.entries(config.targets).map(([name, target]) => ({
      name,
      environment: target.environment ?? null,
      host: isLocalTarget(target) ? 'local' : target.host,
    })),
  );

  app.get('/api/sites', async () => Object.keys(config.sites));

  app.post(
    '/api/runs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['pipeline'],
          additionalProperties: false,
          properties: {
            pipeline: { type: 'string' },
            targets: { type: 'array', items: { type: 'string' } },
            site: { type: 'string' },
            params: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      const body =
        /** @type {{ pipeline: string, targets?: string[], site?: string, params?: Record<string, string> }} */ (
          request.body
        );
      const { id } = await runs.start(body);
      return reply.code(202).send({ id });
    },
  );

  app.post(
    '/api/commands',
    {
      schema: {
        body: {
          type: 'object',
          required: ['command', 'targets'],
          additionalProperties: false,
          properties: {
            command: { type: 'string', minLength: 1 },
            targets: { type: 'array', items: { type: 'string' }, minItems: 1 },
            site: { type: 'string' },
            params: { type: 'object', additionalProperties: { type: 'string' } },
          },
        },
      },
    },
    async (request, reply) => {
      if (!config.dashboard.allowCommands) {
        return reply.code(403).send({ error: 'Commands are disabled (dashboard.allowCommands)' });
      }
      const body =
        /** @type {{ command: string, targets: string[], site?: string, params?: Record<string, string> }} */ (
          request.body
        );
      const { id } = await runs.command(body);
      return reply.code(202).send({ id });
    },
  );

  app.get('/api/runs', async (request) => {
    const query = /** @type {{ limit?: string, pipeline?: string }} */ (request.query);
    const active = [...runs.active.values()].map((run) => ({
      id: run.id,
      pipeline: run.pipeline,
      targets: run.targets,
      status: 'running',
    }));
    const finished = await history.list({
      limit: Number(query.limit ?? 50),
      ...(query.pipeline ? { pipeline: query.pipeline } : {}),
    });
    return [...active, ...finished];
  });

  app.get('/api/runs/:id', async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params);
    const active = runs.active.get(id);
    if (active) {
      return { id, pipeline: active.pipeline, targets: active.targets, status: 'running' };
    }
    const record = await history.get(id);
    return record ?? reply.code(404).send({ error: 'Run not found' });
  });

  app.get('/api/runs/:id/log', async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params);
    const log = await history.readLog(id);
    return log === undefined
      ? reply.code(404).send({ error: 'No log for this run' })
      : reply.type('text/plain').send(log);
  });

  app.post('/api/runs/:id/cancel', async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params);
    return runs.cancel(id)
      ? reply.code(202).send({ id })
      : reply.code(404).send({ error: 'No active run with this id' });
  });

  app.get('/api/git/commits', async (request) => {
    const query = /** @type {{ limit?: string }} */ (request.query);
    return ai.commits(Number(query.limit ?? 15));
  });

  app.post(
    '/api/ai/reviews',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: { sha: { type: 'string' }, provider: { type: 'string' } },
        },
      },
    },
    async (request) =>
      ai.review(/** @type {{ sha?: string, provider?: string }} */ (request.body ?? {})),
  );

  app.get('/api/ai/reviews', async () => ai.reviews());

  app.get('/api/ai/reviews/:id', async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params);
    return (await ai.get(id)) ?? reply.code(404).send({ error: 'Review not found' });
  });

  app.post(
    '/api/jira/issue',
    {
      schema: {
        body: {
          type: 'object',
          required: ['key'],
          additionalProperties: false,
          properties: {
            key: { type: 'string' },
            related: { type: 'boolean' },
            analyze: { type: 'boolean' },
            provider: { type: 'string' },
          },
        },
      },
    },
    async (request) =>
      ai.issue(
        /** @type {{ key: string, related?: boolean, analyze?: boolean, provider?: string }} */ (
          request.body
        ),
      ),
  );

  app.post(
    '/api/jira/board',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            jql: { type: 'string', maxLength: 2000 },
            limit: { type: 'integer' },
            summarize: { type: 'boolean' },
            provider: { type: 'string' },
          },
        },
      },
    },
    async (request) =>
      ai.board(
        /** @type {{ jql?: string, limit?: number, summarize?: boolean, provider?: string }} */ (
          request.body ?? {}
        ),
      ),
  );

  app.get('/api/jira/board/reports', async () => ai.boardReports());

  app.get('/api/jira/board/reports/:id', async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params);
    return (await ai.boardReport(id)) ?? reply.code(404).send({ error: 'Report not found' });
  });

  app.delete('/api/jira/board/reports', async (_request, reply) => {
    await ai.clearBoardReports();
    return reply.code(204).send();
  });

  const visualJobs = new VisualJobs(config.visual);

  app.get('/api/visual/workspace', async () => ({
    job: visualJobs.job,
    counts: await visualJobs.workspace.counts(),
  }));

  app.post(
    '/api/visual/workspace/capture',
    {
      schema: {
        body: {
          type: 'object',
          required: ['phase', 'urls'],
          additionalProperties: false,
          properties: {
            phase: { enum: ['before', 'after'] },
            urls: {
              type: 'array',
              items: { type: 'string', pattern: '^https?://' },
              maxItems: 2000,
            },
            viewport: {
              type: 'object',
              required: ['width', 'height'],
              properties: {
                width: { type: 'integer', minimum: 200, maximum: 3840 },
                height: { type: 'integer', minimum: 200, maximum: 4000 },
              },
            },
            fullPage: { type: 'boolean' },
            settleMs: { type: 'integer', minimum: 0, maximum: 30000 },
            blockTrackers: { type: 'boolean' },
            auth: {
              type: 'object',
              required: ['username', 'password'],
              properties: { username: { type: 'string' }, password: { type: 'string' } },
            },
            cookies: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'value'],
                properties: {
                  name: { type: 'string' },
                  value: { type: 'string' },
                  domain: { type: 'string' },
                  path: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = /** @type {{ phase: 'before' | 'after', urls: string[],
        viewport?: { width: number, height: number }, fullPage?: boolean, settleMs?: number,
        blockTrackers?: boolean, auth?: { username: string, password: string },
        cookies?: { name: string, value: string, domain?: string, path?: string }[] }} */ (
        request.body
      );
      const job = visualJobs.start(body.phase, [...new Set(body.urls)], {
        viewport: body.viewport ?? config.visual.viewport,
        fullPage: body.fullPage ?? config.visual.fullPage,
        settleMs: body.settleMs ?? 600,
        blockTrackers: body.blockTrackers ?? true,
        ...(body.auth?.username ? { credentials: body.auth } : {}),
        ...(body.cookies?.length ? { cookies: body.cookies } : {}),
      });
      return reply.code(202).send(job);
    },
  );

  app.post('/api/visual/workspace/cancel', async () => ({ cancelled: visualJobs.cancel() }));

  app.post('/api/visual/workspace/compare', async (request) => {
    const body = /** @type {{ start?: number, limit?: number }} */ (request.body ?? {});
    const result = await visualJobs.compare({
      start: Math.max(0, Number(body.start ?? 0)),
      limit: Math.min(100, Math.max(1, Number(body.limit ?? 20))),
    });
    /** @param {string} phase @param {string} file */
    const url = (phase, file) => `/files/visual/${phase}/${encodeURIComponent(file)}`;
    return {
      ...result,
      results: result.results.map((item) => ({
        ...item,
        beforeImage: url('before', item.file),
        afterImage: url('after', item.file),
        ...(item.status === 'different'
          ? { diffImage: `${url('diff', item.file)}?v=${Date.now()}` }
          : {}),
      })),
    };
  });

  app.delete('/api/visual/workspace', async (_request, reply) => {
    await visualJobs.clear();
    return reply.code(204).send();
  });

  const workspaceDir = resolve(visualJobs.workspace.dir);
  mkdirSync(workspaceDir, { recursive: true });
  app.register(fastifyStatic, {
    root: workspaceDir,
    prefix: '/files/visual/',
    decorateReply: false,
    index: false,
  });

  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir });
    // Client-side routes: serve index.html for anything that is not the API.
    app.setNotFoundHandler((request, reply) =>
      request.method === 'GET' && !/^\/(api|files)\//.test(request.url)
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'Not found' }),
    );
  }

  return app;
}
