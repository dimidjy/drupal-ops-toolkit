import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RunHistory, Workspace, loadConfig, sshConnector } from '@dops/core';
import { buildServer } from './app.js';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);

/** Output of `npm run build -w @dops/web`. */
export const DASHBOARD_DIR = fileURLToPath(new URL('../../web/dist', import.meta.url));

/**
 * Starts the dashboard server. It binds to localhost unless DOPS_ALLOW_REMOTE=1,
 * because anyone who can reach it can run the configured pipelines.
 *
 * @param {object} options
 * @param {string} options.configFile
 * @param {string} [options.host]
 * @param {number} [options.port]
 * @param {NodeJS.ProcessEnv} [options.env]
 */
export async function startServer({
  configFile,
  host = '127.0.0.1',
  port = 4800,
  env = process.env,
}) {
  if (!LOOPBACK.has(host) && env.DOPS_ALLOW_REMOTE !== '1') {
    throw new Error(
      `Refusing to listen on ${host}: set DOPS_ALLOW_REMOTE=1 if you really want to expose the dashboard`,
    );
  }
  const config = await loadConfig(configFile, env);
  const workspace = await Workspace.open(config.dashboard.workspaceFile, config);
  const token = env.DOPS_TOKEN ?? randomBytes(24).toString('base64url');
  const app = buildServer({
    config,
    history: new RunHistory(),
    connect: sshConnector(config, env),
    workspace,
    token,
    logger: { level: env.DOPS_LOG_LEVEL ?? 'info' },
    staticDir: DASHBOARD_DIR,
  });
  const address = await app.listen({ host, port });
  await /** @type {import('./tests.js').TestSchedules} */ (
    /** @type {any} */ (app).schedules
  ).start();
  if (!env.DOPS_TOKEN) {
    app.log.info(`No DOPS_TOKEN set, generated one for this session: ${token}`);
  }
  app.log.info(`dops dashboard API on ${address}`);
  return app;
}
