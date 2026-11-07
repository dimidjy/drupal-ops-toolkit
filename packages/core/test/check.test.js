import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkProject } from '../src/config/check.js';

/** @param {Record<string, string>} files */
async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'dops-check-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(join(dir, path, '..'), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  return dir;
}

/**
 * @param {import('../src/config/check.js').CheckResult[]} results
 * @param {string} level
 */
const messages = (results, level) =>
  results.filter((result) => result.level === level).map((result) => result.message);

describe('checkProject', () => {
  it('reports what is set up and what is missing, without connecting', async () => {
    const dir = await project({
      'dops.config.yml': `
envFile: project.env
bastions:
  jump:
    host: bastion.example.com
    user: ops
    identityFile: keys/missing_key
targets:
  stage:
    host: 10.0.1.10
    user: deploy
    agent: true
    bastion: jump
  prod1:
    host: 10.0.2.11
    user: deploy
    identityFile: keys/present_key
    production: true
visual:
  urlSets:
    stage:
      baseUrl: https://stage.example.com
      paths: [/]
      httpAuth: { usernameEnv: TEST_HTTP_USER, passwordEnv: TEST_HTTP_PASS }
`,
      'project.env': 'TEST_HTTP_USER=qa\n',
      'keys/present_key': 'key',
    });
    await chmod(join(dir, 'project.env'), 0o644);
    const results = await checkProject(join(dir, 'dops.config.yml'), { HOME: dir });

    expect(messages(results, 'warn')).toEqual([
      expect.stringMatching(/project\.env can be read by other users: chmod 600/),
    ]);
    expect(messages(results, 'error')).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/bastion jump: key file keys\/missing_key not found/),
        expect.stringMatching(/target stage uses the SSH agent, but SSH_AUTH_SOCK is not set/),
        'URL set stage: TEST_HTTP_PASS not set',
      ]),
    );
    expect(messages(results, 'ok')).toEqual(
      expect.arrayContaining([expect.stringMatching(/2 targets, 0 pipelines.*production: prod1/)]),
    );
  });

  it('passes a complete setup', async () => {
    const dir = await project({
      'dops.config.yml': `
envFile: project.env
targets:
  stage: { host: 10.0.1.10, user: deploy, agent: true }
`,
      'project.env': 'X=1\n',
    });
    await chmod(join(dir, 'project.env'), 0o600);
    const results = await checkProject(join(dir, 'dops.config.yml'), {
      SSH_AUTH_SOCK: '/tmp/agent.sock',
    });
    expect(results.filter((result) => result.level !== 'ok')).toEqual([]);
  });

  it('stops at a config that cannot be loaded', async () => {
    const dir = await project({ 'dops.config.yml': 'targets:\n  stage:\n    host: ${NOPE}\n' });
    const results = await checkProject(join(dir, 'dops.config.yml'), {});
    expect(messages(results, 'error')).toEqual([
      expect.stringMatching(/Missing environment variables[\s\S]*NOPE/),
    ]);
  });
});
