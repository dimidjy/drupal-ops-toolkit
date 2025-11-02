import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRemoteCommand, connectionSettings, shellQuote } from '../src/ssh/executor.js';

const endpoint = { host: 'example.test', port: 2222, user: 'deploy', agent: false };

describe('shellQuote / buildRemoteCommand', () => {
  it('quotes single quotes safely', () => {
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  it('changes directory only when a path is given', () => {
    expect(buildRemoteCommand('ls')).toBe('ls');
    expect(buildRemoteCommand('ls', '.')).toBe('ls');
    expect(buildRemoteCommand('drush cr', '/var/www/my site')).toBe(
      `cd '/var/www/my site' && drush cr`,
    );
  });
});

describe('connectionSettings', () => {
  it('loads the key file and the passphrase from the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-'));
    const keyFile = join(dir, 'id_test');
    await writeFile(keyFile, 'PRIVATE KEY');
    const settings = await connectionSettings(
      { ...endpoint, identityFile: keyFile, passphraseEnv: 'KEY_PASS' },
      { KEY_PASS: 'secret' },
    );
    expect(settings).toMatchObject({ host: 'example.test', port: 2222, username: 'deploy' });
    expect(settings.privateKey?.toString()).toBe('PRIVATE KEY');
    expect(settings.passphrase).toBe('secret');
  });

  it('fails clearly when the passphrase variable is missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-'));
    const keyFile = join(dir, 'id_test');
    await writeFile(keyFile, 'KEY');
    await expect(
      connectionSettings({ ...endpoint, identityFile: keyFile, passphraseEnv: 'NOPE' }, {}),
    ).rejects.toThrow(/NOPE is not set/);
  });

  it('uses the SSH agent socket', async () => {
    const settings = await connectionSettings(
      { ...endpoint, agent: true },
      { SSH_AUTH_SOCK: '/tmp/agent.sock' },
    );
    expect(settings.agent).toBe('/tmp/agent.sock');
  });

  it('verifies the host key fingerprint when configured', async () => {
    const settings = await connectionSettings(
      {
        ...endpoint,
        agent: true,
        hostFingerprint: 'SHA256:ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0',
      },
      { SSH_AUTH_SOCK: '/tmp/agent.sock' },
    );
    expect(settings.hostVerifier(Buffer.from('abc'))).toBe(true);
    expect(settings.hostVerifier(Buffer.from('other'))).toBe(false);
  });
});
