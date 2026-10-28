import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { PipelineRunner, parseConfig, pullDatabase, sshConnector } from '@dops/core';

const key = process.env.DOPS_IT_KEY;
if (!key) throw new Error('Run through test/integration/run.sh (DOPS_IT_KEY is not set)');

const config = parseConfig(`
bastions:
  jump: { host: 127.0.0.1, port: 2222, user: deploy, identityFile: ${key} }
targets:
  app: { host: target, user: deploy, identityFile: ${key}, bastion: jump, path: /var/www/site }
sites:
  fr: { greeting: bonjour }
pipelines:
  release:
    targets: [app]
    steps:
      - { name: Where am I, run: 'echo "{greeting} from $(hostname) in $(pwd)"' }
      - { name: Write release, run: 'echo v1 > RELEASE && cat RELEASE' }
      - { name: Break, run: 'echo boom >&2; exit 3' }
      - { name: Never runs, run: 'touch never' }
`);

const connect = sshConnector(config);
const target = /** @type {import('@dops/core').Target} */ (config.targets.app);

describe('over a real bastion', () => {
  it('runs a pipeline, streams output and stops at the failing step', async () => {
    const runner = new PipelineRunner();
    /** @type {string[]} */
    const output = [];
    runner.on('event', (event) => {
      if (event.type === 'output') output.push(event.text);
    });
    const record = await runner.run({
      pipelineName: 'release',
      pipeline: /** @type {import('@dops/core').Pipeline} */ (config.pipelines.release),
      targets: { app: target },
      site: { name: 'fr', params: { greeting: 'bonjour' } },
      connect,
    });

    expect(record.status).toBe('failed');
    expect(record.steps.map((step) => step.status)).toEqual(['ok', 'ok', 'failed', 'skipped']);
    const text = output.join('');
    expect(text).toMatch(/bonjour from \w+ in \/var\/www\/site/);
    expect(text).toContain('v1');
    expect(text).toContain('boom');
  });

  it('streams a gzipped dump through the tunnel byte for byte', async () => {
    const executor = await connect('app', target);
    try {
      const file = join(await mkdtemp(join(tmpdir(), 'dops-it-')), 'dump.sql.gz');
      const result = await pullDatabase({
        executor,
        command: 'for i in $(seq 1 20000); do echo "INSERT INTO t VALUES ($i);"; done | gzip -c',
        cwd: target.path,
        file,
      });
      const sql = gunzipSync(await readFile(file)).toString();
      expect(result.bytes).toBeGreaterThan(1000);
      expect(sql.split('\n')[19_999]).toBe('INSERT INTO t VALUES (20000);');
    } finally {
      await executor.close();
    }
  });

  it('cannot reach the target without the bastion', async () => {
    const direct = sshConnector({ ...config, bastions: {} });
    await expect(direct('app', { ...target, bastion: undefined })).rejects.toThrow();
  });
});
