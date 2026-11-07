import { chmod, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { RunHistory, parseConfig } from '@dops/core';
import { createProgram } from '../src/program.js';

const config = parseConfig(`
params:
  branch: { description: Git branch to deploy, default: main }
  module: { description: Module to enable }
sites:
  default: { alias: '@self' }
  fr: { alias: '@fr', uri: fr.example.com }
targets:
  web1: { host: 10.0.0.1, user: deploy, agent: true, path: /var/www/site }
  web2: { host: 10.0.0.2, user: deploy, agent: true, path: /var/www/site }
  prod1: { host: 10.0.9.1, user: deploy, agent: true, path: /var/www/site, production: true }
pipelines:
  prod-cache:
    targets: [prod1]
    steps:
      - { name: Cache, run: vendor/bin/drush cr }
  cache-clear:
    description: Rebuild Drupal caches
    targets: [web1, web2]
    steps:
      - { name: Cache, run: vendor/bin/drush cr }
  checkout:
    targets: [web1]
    steps:
      - { name: Checkout, run: 'git checkout {branch}' }
  enable:
    targets: [web1]
    steps:
      - { name: Enable, run: 'drush en {module} -y' }
  site-cache:
    targets: [web1]
    steps:
      - { name: Cache, run: 'vendor/bin/drush {alias} cr' }
uiTests:
  suites:
    smoke:
      testDir: tests/smoke
      baseUrl: 'https://shop.ddev.site'
      environments: { stage: 'https://stage.example.com' }
`);

async function run(args, { exitCodes = {} } = {}) {
  let out = '';
  const commands = [];
  const local = [];
  const dir = await mkdtemp(join(tmpdir(), 'dops-cli-'));
  const program = createProgram({
    loadConfig: async () => config,
    history: () => new RunHistory(dir),
    write: (text) => (out += text),
    runLocal: async (command) => {
      local.push(command);
      return 0;
    },
    connector: () => async (name) => ({
      exec: async (command, options = {}) => {
        commands.push(`${name}: ${command}`);
        options.stdout?.write(gzipSync('-- dump\n'));
        return { code: exitCodes[name] ?? 0 };
      },
      close: async () => {},
    }),
  });
  /** @param {import('commander').Command} command */
  const throwInsteadOfExit = (command) => {
    command.exitOverride().configureOutput({ writeErr: () => {} });
    command.commands.forEach(throwInsteadOfExit);
  };
  throwInsteadOfExit(program);
  await program.parseAsync(['node', 'dops', ...args]);
  return { out, commands, local, history: new RunHistory(dir) };
}

afterEach(() => {
  process.exitCode = undefined;
});

describe('dops CLI', () => {
  it('lists pipelines', async () => {
    const { out } = await run(['pipelines']);
    expect(out).toContain('cache-clear');
    expect(out).toContain('Rebuild Drupal caches');
  });

  it('deploys to the default targets and records history', async () => {
    const { out, commands, history } = await run(['deploy', 'cache-clear']);
    expect(commands).toEqual(['web1: vendor/bin/drush cr', 'web2: vendor/bin/drush cr']);
    expect(out).toContain('cache-clear: ok');
    expect((await history.list())[0]?.status).toBe('ok');
    expect(process.exitCode).toBeUndefined();
  });

  it('can target a single server and sets a failing exit code', async () => {
    const { commands } = await run(['deploy', 'cache-clear', '-t', 'web2'], {
      exitCodes: { web2: 1 },
    });
    expect(commands).toEqual(['web2: vendor/bin/drush cr']);
    expect(process.exitCode).toBe(1);
  });

  it('prints rendered commands in dry-run mode without connecting', async () => {
    const { out, commands } = await run(['deploy', 'cache-clear', '--dry-run']);
    expect(commands).toEqual([]);
    expect(out).toContain('deploy@10.0.0.1:/var/www/site');
    expect(out).toContain('Cache: vendor/bin/drush cr');
  });

  it('lists recorded runs and shows a run log', async () => {
    const { history } = await run(['deploy', 'cache-clear']);
    const [latest] = await history.list();
    let out = '';
    const program = createProgram({ history: () => history, write: (t) => (out += t) });
    program.exitOverride();
    await program.parseAsync(['node', 'dops', 'history']);
    expect(out).toContain('cache-clear → web1, web2');
    await program.parseAsync(['node', 'dops', 'history', 'show', latest.id]);
    expect(out).toContain('ok       [web2] Cache');
  });

  it('fills site parameters with --site', async () => {
    const { commands } = await run(['deploy', 'site-cache', '--site', 'fr']);
    expect(commands).toEqual(['web1: vendor/bin/drush @fr cr']);
    const { out } = await run(['sites']);
    expect(out).toContain('alias=@fr uri=fr.example.com');
  });

  it('rejects unknown sites', async () => {
    await expect(run(['deploy', 'site-cache', '--site', 'de'])).rejects.toThrow(/Unknown site/);
  });

  it('runs an ad-hoc command on several targets', async () => {
    const { commands, history } = await run([
      'exec',
      '-t',
      'web1',
      'web2',
      '--',
      'drush',
      'status',
    ]);
    expect(commands).toEqual(['web1: drush status', 'web2: drush status']);
    expect((await history.list())[0]?.pipeline).toBe('command');
  });

  it('fills parameters from defaults and --param', async () => {
    expect((await run(['deploy', 'checkout'])).commands).toEqual(['web1: git checkout main']);
    const { commands } = await run(['deploy', 'checkout', '-p', 'branch=release/2.4']);
    expect(commands).toEqual(['web1: git checkout release/2.4']);
  });

  it('lists missing parameters with their description', async () => {
    await expect(run(['deploy', 'enable'])).rejects.toThrow(/-p module=…\s+\(Module to enable\)/);
  });

  it('pulls a database dump with site parameters', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dops-db-')), 'fr.sql.gz');
    const { commands, out } = await run(['db', 'pull', 'web1', '--site', 'fr', '-o', file]);
    expect(commands).toEqual([
      'web1: vendor/bin/drush @fr sql-dump --structure-tables-list=cache,cache_*,flood,sessions,watchdog | gzip -c',
    ]);
    expect(out).toContain(file);
    expect((await stat(file)).size).toBeGreaterThan(0);
  });

  it('imports the pulled dump locally with --import', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dops-db-')), 'prod dump.sql.gz');
    const { local } = await run(['db', 'pull', 'web1', '-o', file, '--import']);
    expect(local).toEqual([`ddev import-db --file='${file}'`]);
  });

  it('needs --yes before touching production targets', async () => {
    await expect(run(['run', 'prod-cache'])).rejects.toThrow(
      /Production targets: prod1\. Check what will run first, then pass --yes/,
    );
    await expect(run(['exec', '-t', 'prod1', '--', 'uptime'])).rejects.toThrow(/prod1/);
    const dry = await run(['run', 'prod-cache', '--dry-run']);
    expect(dry.commands).toEqual([]);
    expect(dry.out).toContain('Cache: vendor/bin/drush cr');
    expect(dry.out).toContain('(production)');
    expect((await run(['run', 'prod-cache', '--yes'])).commands).toEqual([
      'prod1: vendor/bin/drush cr',
    ]);
    expect((await run(['exec', '-y', '-t', 'prod1', '--', 'uptime'])).commands).toEqual([
      'prod1: uptime',
    ]);
  });

  it('needs --yes before pulling a database from production', async () => {
    const file = join(await mkdtemp(join(tmpdir(), 'dops-db-')), 'prod.sql.gz');
    await expect(run(['db', 'pull', 'prod1', '-o', file])).rejects.toThrow(/prod1/);
    expect((await run(['db', 'pull', 'prod1', '-o', file, '--yes'])).commands).toHaveLength(1);
  });

  it('keeps deploy as another name for run', async () => {
    expect((await run(['deploy', 'cache-clear'])).commands).toEqual([
      'web1: vendor/bin/drush cr',
      'web2: vendor/bin/drush cr',
    ]);
  });

  it('marks production targets in the pipeline list', async () => {
    const { out } = await run(['pipelines']);
    expect(out).toMatch(/prod-cache .*prod1 .*\(production\)/);
  });

  it('rejects an unknown test environment before running anything', async () => {
    await expect(run(['test', 'run', 'smoke', '-e', 'nope'])).rejects.toThrow(
      /Suite "smoke" has no environment "nope" \(stage\)/,
    );
  });

  it('rejects a limit that is not a whole number', async () => {
    await expect(run(['history', '-l', 'abc'])).rejects.toThrow(/whole number from 1 to 1000/);
    await expect(run(['test', 'history', '-l', '0'])).rejects.toThrow(/whole number/);
  });

  it('lists targets by environment, as text or JSON', async () => {
    const { out } = await run(['targets']);
    expect(out).toContain('(no environment)');
    expect(out).toMatch(/prod1 .*deploy@10\.0\.9\.1:\/var\/www\/site.*\(production\)/);
    const json = JSON.parse((await run(['targets', '--json'])).out);
    expect(json.find((target) => target.name === 'prod1')).toMatchObject({
      production: true,
      local: false,
      address: 'deploy@10.0.9.1:/var/www/site',
    });
  });

  it('prints pipelines and run history as JSON', async () => {
    const pipelines = JSON.parse((await run(['pipelines', '--json'])).out);
    expect(pipelines.find((pipeline) => pipeline.name === 'prod-cache')).toEqual({
      name: 'prod-cache',
      description: null,
      targets: [{ name: 'prod1', production: true }],
      steps: [{ name: 'Cache', run: 'vendor/bin/drush cr' }],
    });
    expect(JSON.parse((await run(['history', '--json'])).out)).toEqual([]);
  });

  it('checks a project and fails on errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-cli-check-'));
    await writeFile(join(dir, 'dops.config.yml'), 'envFile: project.env\ntargets: {}\n');
    await writeFile(join(dir, 'project.env'), 'X=1\n');
    await chmod(join(dir, 'project.env'), 0o600);
    const ok = await run(['-c', join(dir, 'dops.config.yml'), 'check']);
    expect(ok.out).toMatch(/0 error\(s\), 0 warning\(s\)/);
    expect(process.exitCode).toBeUndefined();

    await writeFile(join(dir, 'broken.yml'), 'envFile: nowhere.env\n');
    const failed = await run(['-c', join(dir, 'broken.yml'), 'check', '--json']);
    expect(JSON.parse(failed.out)).toEqual([
      expect.objectContaining({ level: 'error', area: 'env' }),
      expect.objectContaining({ level: 'error', area: 'config' }),
    ]);
    expect(process.exitCode).toBe(1);
  });

  it('rejects unknown pipelines', async () => {
    await expect(run(['deploy', 'nope'])).rejects.toThrow(/Unknown pipeline "nope"/);
  });
});
