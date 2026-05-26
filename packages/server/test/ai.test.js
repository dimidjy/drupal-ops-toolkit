import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseConfig } from '@dops/core';
import { AiService, aiCommand } from '../src/ai.js';

const REVIEW = {
  summary: 'Adds a block.',
  verdict: 'comment',
  findings: [{ file: 'a.php', line: 3, severity: 'minor', message: 'x' }],
};

/** @param {Record<string, { code?: number, stdout?: string, stderr?: string }>} replies */
function fakeShell(replies) {
  /** @type {{ command: string, cwd: string }[]} */
  const calls = [];
  /** @type {import('../src/ai.js').runShell} */
  const run = async (command, { cwd }) => {
    calls.push({ command, cwd });
    const key = Object.keys(replies).find((prefix) => command.includes(prefix));
    const reply = key ? replies[key] : undefined;
    return { code: reply?.code ?? 0, stdout: reply?.stdout ?? '', stderr: reply?.stderr ?? '' };
  };
  return { run, calls };
}

describe('AiService', () => {
  const config = parseConfig(`ai: { command: dops-ai, repo: /srv/shop, provider: anthropic }`);

  it('lists recent commits from the configured repository', async () => {
    const shell = fakeShell({
      'git log -n': {
        stdout: 'abc123\x1fDev One\x1f2026-03-11T10:00:00+02:00\x1fSHOP-7: search\n',
      },
    });
    const service = new AiService(config, { run: shell.run });
    expect(await service.commits(10)).toEqual([
      {
        sha: 'abc123',
        author: 'Dev One',
        date: '2026-03-11T10:00:00+02:00',
        subject: 'SHOP-7: search',
      },
    ]);
    expect(shell.calls[0]?.cwd).toBe('/srv/shop');
  });

  it('reviews a commit with dops-ai, stores and lists the result', async () => {
    const shell = fakeShell({
      'dops-ai commit': { stdout: JSON.stringify(REVIEW) },
      'git log -1': { stdout: 'SHOP-7: search\n' },
    });
    const storeDir = await mkdtemp(join(tmpdir(), 'dops-reviews-'));
    const service = new AiService(config, { run: shell.run, storeDir });

    const record = await service.review({ sha: 'abc1234' });

    expect(shell.calls[0]?.command).toBe(
      'dops-ai commit abc1234 --json --no-strict --provider anthropic',
    );
    expect(record.review.verdict).toBe('comment');
    expect(await service.reviews()).toMatchObject([
      { subject: 'SHOP-7: search', verdict: 'comment', findings: 1 },
    ]);
    expect((await service.get(record.id))?.review.summary).toBe('Adds a block.');
  });

  it('rejects odd input and reports dops-ai errors', async () => {
    const shell = fakeShell({
      'dops-ai review': { code: 2, stderr: 'error: OPENAI_API_KEY is not set\n' },
    });
    const service = new AiService(config, {
      run: shell.run,
      storeDir: await mkdtemp(join(tmpdir(), 'r-')),
    });
    await expect(service.review({ sha: 'HEAD; rm -rf /' })).rejects.toThrow(/Invalid commit/);
    await expect(service.review({ provider: 'other' })).rejects.toThrow(/Unknown provider/);
    await expect(service.review({})).rejects.toThrow(/OPENAI_API_KEY is not set/);
  });

  it('uses the bundled Python package by default', () => {
    expect(aiCommand(parseConfig(''))).toMatch(
      /uv run --quiet --project '.*python\/ai-review' dops-ai/,
    );
  });

  it('loads an issue with the right flags and validates the key', async () => {
    const shell = fakeShell({ 'dops-ai issue': { stdout: '{"issue":{"key":"SHOP-7"}}' } });
    const service = new AiService(config, { run: shell.run });
    expect(await service.issue({ key: 'shop-7', analyze: true })).toEqual({
      issue: { key: 'SHOP-7' },
    });
    expect(shell.calls[0]?.command).toBe(
      'dops-ai issue SHOP-7 --json --raw --related --analyze --provider anthropic',
    );
    await expect(service.issue({ key: 'SHOP-7; id' })).rejects.toThrow(/issue key/);
  });

  it('runs the board with a quoted JQL and keeps the reports', async () => {
    const report = {
      jql: "project = SHOP AND status != 'Done'",
      generated_at: '2026-05-26T08:00:00Z',
      issues: [{}, {}],
      stale: ['SHOP-1'],
      summary: null,
    };
    const shell = fakeShell({ 'dops-ai board': { stdout: JSON.stringify(report) } });
    const boardDir = await mkdtemp(join(tmpdir(), 'dops-board-'));
    const service = new AiService(config, { run: shell.run, boardDir });

    const saved = await service.board({ jql: "project = SHOP AND status != 'Done'", limit: 50 });

    expect(shell.calls[0]?.command).toBe(
      `dops-ai board --json --limit 50 --jql 'project = SHOP AND status != '\\''Done'\\'''`,
    );
    expect(await service.boardReports()).toEqual([
      {
        id: saved.id,
        jql: report.jql,
        generatedAt: report.generated_at,
        issues: 2,
        stale: 1,
        summarized: false,
      },
    ]);
    expect((await service.boardReport(saved.id))?.stale).toEqual(['SHOP-1']);
    await service.clearBoardReports();
    expect(await service.boardReports()).toEqual([]);
  });
});
