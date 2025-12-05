import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { RunConflictError, RunManager } from './runs.js';

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

/** @param {FastifyRequest} request */
function requestToken(request) {
  const header = request.headers.authorization ?? '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length);
  // Browsers cannot set headers on WebSocket connections.
  const query = /** @type {{ token?: string }} */ (request.query);
  return query.token ?? '';
}

/** @param {ServerOptions} options */
export function buildServer({ config, history, connect, token, logger = false, staticDir }) {
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
    if (request.url.startsWith('/api/') && !sameToken(requestToken(request), token)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  app.setErrorHandler((/** @type {import('fastify').FastifyError} */ error, _request, reply) => {
    if (error instanceof RunConflictError) {
      return reply.code(409).send({ error: error.message });
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

  app.get('/api/pipelines', async () =>
    Object.entries(config.pipelines).map(([name, pipeline]) => ({
      name,
      description: pipeline.description ?? null,
      targets: pipeline.targets,
      steps: pipeline.steps.map((step) => ({ name: step.name, run: step.run })),
    })),
  );

  app.get('/api/targets', async () =>
    Object.entries(config.targets).map(([name, target]) => ({
      name,
      environment: target.environment ?? null,
      host: target.host,
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
          },
        },
      },
    },
    async (request, reply) => {
      const body = /** @type {{ pipeline: string, targets?: string[], site?: string }} */ (
        request.body
      );
      const { id } = await runs.start(body);
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

  if (staticDir && existsSync(staticDir)) {
    app.register(fastifyStatic, { root: staticDir });
    // Client-side routes: serve index.html for anything that is not the API.
    app.setNotFoundHandler((request, reply) =>
      request.method === 'GET' && !request.url.startsWith('/api/')
        ? reply.sendFile('index.html')
        : reply.code(404).send({ error: 'Not found' }),
    );
  }

  return app;
}
