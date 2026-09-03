import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnvFile } from '../src/config/env.js';

describe('loadEnvFile', () => {
  it('fills in variables that are not set yet', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dops-env-'));
    const file = join(dir, '.env');
    await writeFile(file, '# comment\nDOPS_TOKEN=from-file\nJIRA_URL="https://x.atlassian.net"\n');
    /** @type {NodeJS.ProcessEnv} */
    const env = { DOPS_TOKEN: 'from-shell' };

    const loaded = await loadEnvFile(file, env);

    expect(loaded).toEqual(['JIRA_URL']);
    expect(env).toEqual({ DOPS_TOKEN: 'from-shell', JIRA_URL: 'https://x.atlassian.net' });
  });

  it('ignores a missing file', async () => {
    expect(await loadEnvFile('/nonexistent/.env', {})).toEqual([]);
  });
});
