import { mkdtemp, stat } from 'node:fs/promises';
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
pipelines:
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
`);

async function run(args, { exitCodes = {} } = {}) {
  let out = '';
  const commands = [];
  const dir = await mkdtemp(join(tmpdir(), 'dops-cli-'));
  const program = createProgram({
    loadConfig: async () => config,
    history: () => new RunHistory(dir),
    write: (text) => (out += text),
    connector: () => async (name) => ({
      exec: async (command, options = {}) => {
        commands.push(`${name}: ${command}`);
        options.stdout?.write(gzipSync('-- dump\n'));
        return { code: exitCodes[name] ?? 0 };
      },
      close: async () => {},
    }),
  });
  program.exitOverride();
  await program.parseAsync(['node', 'dops', ...args]);
  return { out, commands, history: new RunHistory(dir) };
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

  it('rejects unknown pipelines', async () => {
    await expect(run(['deploy', 'nope'])).rejects.toThrow(/Unknown pipeline "nope"/);
  });
});
