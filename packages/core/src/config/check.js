import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parse } from 'yaml';
import { expandHome, loadConfig, loadProjectEnv } from './load.js';
import { isLocalTarget } from './schema.js';

/**
 * @typedef {'ok' | 'warn' | 'error'} CheckLevel
 *
 * @typedef {object} CheckResult
 * @property {CheckLevel} level
 * @property {string} area e.g. "config", "env", "ssh", "visual"
 * @property {string} message
 */

/**
 * Checks a project's setup without connecting anywhere: the config and its
 * folders, the env file and its permissions, the variables named for basic
 * auth and webhooks, SSH key files and the agent, and local paths.
 *
 * @param {string} file the config file
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Promise<CheckResult[]>}
 */
export async function checkProject(file, env = process.env) {
  /** @type {CheckResult[]} */
  const results = [];
  /**
   * @param {CheckLevel} level
   * @param {string} area
   * @param {string} message
   */
  const add = (level, area, message) => results.push({ level, area, message });
  /** @param {unknown} error */
  const messageOf = (error) => (error instanceof Error ? error.message : String(error));

  let raw;
  try {
    raw = parse(await readFile(file, 'utf8')) ?? {};
  } catch (error) {
    add('error', 'config', `Cannot read ${file}: ${messageOf(error).split('\n')[0]}`);
    return results;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    add('error', 'config', `${file} must contain a YAML mapping`);
    return results;
  }

  try {
    const envFiles = await loadProjectEnv(raw, dirname(resolve(file)), env);
    if (!envFiles.length) {
      add(
        'warn',
        'env',
        'No env file found: set envFile in the config to the project secrets file',
      );
    }
    for (const envFile of envFiles) {
      const { mode } = await stat(envFile);
      if (mode & 0o077) {
        add('warn', 'env', `${envFile} can be read by other users: chmod 600 ${envFile}`);
      } else {
        add('ok', 'env', `Read ${envFile}`);
      }
    }
  } catch (error) {
    add('error', 'env', messageOf(error));
  }

  let config;
  try {
    config = await loadConfig(file, env);
  } catch (error) {
    add('error', 'config', messageOf(error));
    return results;
  }
  const production = Object.entries(config.targets)
    .filter(([, target]) => target.production)
    .map(([name]) => name);
  add(
    'ok',
    'config',
    `${Object.keys(config.targets).length} targets, ${Object.keys(config.pipelines).length} pipelines, ` +
      `${Object.keys(config.sites).length} sites${production.length ? `; production: ${production.join(', ')}` : ''}`,
  );

  const endpoints = [
    ...Object.entries(config.bastions).map(([name, bastion]) => ({
      label: `bastion ${name}`,
      endpoint: bastion,
    })),
    ...Object.entries(config.targets).flatMap(([name, target]) =>
      isLocalTarget(target) ? [] : [{ label: `target ${name}`, endpoint: target }],
    ),
  ];
  let sshProblems = 0;
  for (const { label, endpoint } of endpoints) {
    if (endpoint.identityFile && !existsSync(expandHome(endpoint.identityFile))) {
      add('error', 'ssh', `${label}: key file ${endpoint.identityFile} not found`);
      sshProblems++;
    }
    if (endpoint.agent && !env.SSH_AUTH_SOCK) {
      add('error', 'ssh', `${label} uses the SSH agent, but SSH_AUTH_SOCK is not set`);
      sshProblems++;
    }
    if (endpoint.passphraseEnv && !env[endpoint.passphraseEnv]) {
      add('warn', 'ssh', `${label}: ${endpoint.passphraseEnv} is not set`);
    }
  }
  if (endpoints.length && !sshProblems) {
    add('ok', 'ssh', `Keys or agent available for ${endpoints.length} SSH endpoint(s)`);
  }

  for (const [name, target] of Object.entries(config.targets)) {
    if (isLocalTarget(target) && !existsSync(expandHome(target.path))) {
      add('warn', 'local', `target ${name}: path ${target.path} not found`);
    }
  }

  /**
   * @param {string} area
   * @param {string} label
   * @param {{ usernameEnv: string, passwordEnv: string } | undefined} auth
   */
  const checkAuth = (area, label, auth) => {
    if (!auth) return;
    const missing = [auth.usernameEnv, auth.passwordEnv].filter((name) => !env[name]);
    if (missing.length) add('error', area, `${label}: ${missing.join(' and ')} not set`);
  };
  for (const [name, urlSet] of Object.entries(config.visual.urlSets)) {
    checkAuth('visual', `URL set ${name}`, urlSet.httpAuth);
  }
  for (const [name, suite] of Object.entries(config.uiTests.suites)) {
    checkAuth('tests', `suite ${name}`, suite.httpAuth);
    if (!existsSync(suite.testDir)) {
      add('warn', 'tests', `suite ${name}: test folder ${suite.testDir} not found from here`);
    }
  }
  if (config.uiTests.notify && !env[config.uiTests.notify.webhookEnv]) {
    add(
      'warn',
      'tests',
      `${config.uiTests.notify.webhookEnv} is not set: failing runs are not reported`,
    );
  }

  return results;
}
