import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, parseConfig } from '../src/config/load.js';

describe('loadConfig with the project env file', () => {
  const config = `
envFile: secrets/project.env
targets:
  stage:
    host: \${STAGE_HOST}
    user: \${STAGE_USER}
    agent: true
`;

  /** @param {Record<string, string>} files */
  const write = async (files) => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-envfile-'));
    for (const [path, text] of Object.entries(files)) {
      await mkdir(join(dir, path, '..'), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    return dir;
  };

  it('reads envFile before resolving ${VAR}, and the shell wins', async () => {
    const dir = await write({
      'dops.config.yml': config,
      'secrets/project.env': 'STAGE_HOST=10.0.1.10\nSTAGE_USER=from-file\n',
    });
    /** @type {NodeJS.ProcessEnv} */
    const env = { STAGE_USER: 'from-shell' };
    const loaded = await loadConfig(join(dir, 'dops.config.yml'), env);
    expect(loaded.targets.stage).toMatchObject({ host: '10.0.1.10', user: 'from-shell' });
    expect(env.STAGE_HOST).toBe('10.0.1.10');
  });

  it('prefers DOPS_ENV_FILE, then envFile, then .env next to the config', async () => {
    const dir = await write({
      'dops.config.yml': config,
      'secrets/project.env': 'STAGE_HOST=from-envfile\n',
      '.env': 'STAGE_HOST=from-dotenv\nSTAGE_USER=from-dotenv\n',
      'override.env': 'STAGE_HOST=from-override\n',
    });
    const loaded = await loadConfig(join(dir, 'dops.config.yml'), {
      DOPS_ENV_FILE: join(dir, 'override.env'),
    });
    expect(loaded.targets.stage).toMatchObject({ host: 'from-override', user: 'from-dotenv' });
  });

  it('fails clearly when envFile points nowhere', async () => {
    const dir = await write({ 'dops.config.yml': config });
    await expect(loadConfig(join(dir, 'dops.config.yml'), {})).rejects.toThrowError(
      /envFile not found: .*secrets\/project\.env/,
    );
  });
});

/**
 * Writes a project folder: the main config plus files under it.
 *
 * @param {Record<string, string>} files relative path → YAML text
 */
async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'dops-config-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return join(dir, 'dops.config.yml');
}

const stagingEnv = `
bastions:
  jump: { host: bastion.example.com, user: ops, agent: true }
targets:
  stage-web:
    host: \${STAGE_HOST}
    user: deploy
    agent: true
    bastion: jump
    path: /var/www/site
`;

const prodEnv = `
production: true
targets:
  prod-web1: { host: 10.0.2.11, user: deploy, agent: true, bastion: jump }
  prod-web2: { host: 10.0.2.12, user: deploy, agent: true, bastion: jump }
`;

describe('loadConfig with pipeline and environment folders', () => {
  it('reads environments and pipelines next to the config file', async () => {
    const file = await project({
      'dops.config.yml': 'sites:\n  default: { alias: "@self" }\n',
      'environments/staging.yml': stagingEnv,
      'environments/prod.yml': prodEnv,
      'pipelines/cache-clear.yml': `
description: Rebuild caches
environment: prod
steps:
  - name: Rebuild caches
    run: vendor/bin/drush {alias} cr
`,
      'pipelines/status.yaml': `
targets: [stage-web]
steps:
  - { name: Status, run: vendor/bin/drush status }
`,
    });
    const config = await loadConfig(file, { STAGE_HOST: '10.0.1.10' });
    expect(config.targets['stage-web']).toMatchObject({
      host: '10.0.1.10',
      environment: 'staging',
      production: false,
    });
    expect(config.targets['prod-web1']).toMatchObject({ environment: 'prod', production: true });
    expect(config.pipelines['cache-clear']?.targets).toEqual(['prod-web1', 'prod-web2']);
    expect(config.pipelines.status?.targets).toEqual(['stage-web']);
  });

  it('works without the folders', async () => {
    const file = await project({ 'dops.config.yml': 'pipelines: {}\n' });
    const config = await loadConfig(file, {});
    expect(config.pipelines).toEqual({});
  });

  it('rejects names defined twice', async () => {
    const file = await project({
      'dops.config.yml': `
targets:
  stage-web: { local: true }
pipelines:
  status:
    targets: [stage-web]
    steps: [{ name: Status, run: drush status }]
`,
      'environments/staging.yml': stagingEnv,
      'pipelines/status.yml':
        'targets: [stage-web]\nsteps: [{ name: Status, run: drush status }]\n',
    });
    await expect(loadConfig(file, { STAGE_HOST: 'x' })).rejects.toThrowError(
      /target "stage-web" is already defined[\s\S]*pipeline "status" is already defined/,
    );
  });

  it('reports a pipeline whose environment has no targets', async () => {
    const file = await project({
      'dops.config.yml': '{}\n',
      'pipelines/deploy.yml': 'environment: preprod\nsteps: [{ name: Pull, run: git pull }]\n',
    });
    await expect(loadConfig(file, {})).rejects.toThrowError(/environment "preprod" has no targets/);
  });

  it('names the file that cannot be parsed', async () => {
    const file = await project({
      'dops.config.yml': '{}\n',
      'pipelines/broken.yml': 'steps: [unclosed\n',
    });
    await expect(loadConfig(file, {})).rejects.toThrowError(/Cannot parse .*broken\.yml/);
  });
});

const valid = `
bastions:
  jump:
    host: bastion.example.com
    user: ops
    agent: true
targets:
  staging:
    host: \${STAGING_HOST}
    user: deploy
    identityFile: ~/.ssh/id_ed25519
    bastion: jump
    path: /var/www/site
pipelines:
  deploy:
    targets: [staging]
    steps:
      - name: Pull code
        run: git pull --ff-only
`;

describe('parseConfig', () => {
  it('applies defaults and interpolates environment variables', () => {
    const config = parseConfig(valid, { STAGING_HOST: '10.0.0.5' });
    expect(config.targets.staging?.host).toBe('10.0.0.5');
    expect(config.targets.staging?.port).toBe(22);
    expect(config.pipelines.deploy?.steps[0]?.continueOnError).toBe(false);
    expect(config.sites).toEqual({});
  });

  it('reports missing environment variables', () => {
    expect(() => parseConfig(valid, {})).toThrowError(/STAGING_HOST/);
  });

  it('rejects references to unknown targets and bastions', () => {
    const broken = valid
      .replace('bastion: jump', 'bastion: nope')
      .replace('targets: [staging]', 'targets: [prod]');
    try {
      parseConfig(broken, { STAGING_HOST: 'x' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const issues = error.issues.join('\n');
      expect(issues).toContain('unknown bastion "nope"');
      expect(issues).toContain('unknown target "prod"');
    }
  });

  it('requires a key file or the SSH agent for every target', () => {
    const noAuth = valid.replace('    identityFile: ~/.ssh/id_ed25519\n', '');
    expect(() => parseConfig(noAuth, { STAGING_HOST: 'x' })).toThrowError(/identityFile or agent/);
  });
});
