import { describe, expect, it } from 'vitest';
import { ConfigError, parseConfig } from '../src/config/load.js';

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
