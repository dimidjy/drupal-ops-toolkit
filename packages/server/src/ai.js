import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandHome, shellQuote } from '@dops/core';

/**
 * @import { Config } from '@dops/core'
 */

/** The Python package of this repository, used when ai.command is not set. */
const BUNDLED = fileURLToPath(new URL('../../../python/ai-review', import.meta.url));

/** @param {Config} config */
export function aiCommand(config) {
  if (config.ai.command) return config.ai.command;
  return existsSync(BUNDLED)
    ? `uv run --quiet --project ${shellQuote(BUNDLED)} dops-ai`
    : 'dops-ai';
}

/**
 * Runs a shell command and collects its output.
 *
 * @param {string} command
 * @param {{ cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runShell(command, { cwd, timeoutMs, env = process.env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, env });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * @typedef {object} CommitInfo
 * @property {string} sha
 * @property {string} author
 * @property {string} date
 * @property {string} subject
 */

/**
 * Commits, reviews and their history for the dashboard's Review tab.
 */
export class AiService {
  /**
   * @param {Config} config
   * @param {{ run?: typeof runShell, storeDir?: string, boardDir?: string }} [options]
   */
  constructor(
    config,
    { run = runShell, storeDir = '.dops/reviews', boardDir = '.dops/board' } = {},
  ) {
    this.config = config;
    this.run = run;
    this.storeDir = storeDir;
    this.boardDir = boardDir;
  }

  /**
   * Runs dops-ai with arguments and parses its JSON output.
   *
   * @param {string} args Already shell-quoted.
   */
  async #json(args) {
    const { code, stdout, stderr } = await this.run(`${aiCommand(this.config)} ${args}`, {
      cwd: this.repo,
      timeoutMs: 5 * 60_000,
    });
    if (code !== 0) {
      throw Object.assign(new Error(lastLine(stderr) || `dops-ai exited with ${code}`), {
        statusCode: 502,
      });
    }
    return JSON.parse(stdout);
  }

  /** @param {string} provider */
  #checkProvider(provider) {
    if (!['openai', 'anthropic'].includes(provider)) {
      throw Object.assign(new Error('Unknown provider'), { statusCode: 400 });
    }
  }

  /**
   * A Jira issue with comments, related issues and, if asked, an AI analysis.
   *
   * @param {{ key: string, related?: boolean, analyze?: boolean, provider?: string }} request
   */
  async issue({ key, related = true, analyze = false, provider = this.config.ai.provider }) {
    if (!/^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/.test(key)) {
      throw Object.assign(new Error('Expected an issue key like SHOP-42'), { statusCode: 400 });
    }
    this.#checkProvider(provider);
    const flags = [
      related ? '--related' : '--no-related',
      ...(analyze ? ['--analyze', `--provider ${provider}`] : []),
    ];
    return this.#json(`issue ${key.toUpperCase()} --json --raw ${flags.join(' ')}`);
  }

  /**
   * Board overview for a JQL query (DOPS_JIRA_JQL when empty), saved as a report.
   *
   * @param {{ jql?: string, limit?: number, summarize?: boolean, provider?: string }} request
   */
  async board({ jql = '', limit = 100, summarize = false, provider = this.config.ai.provider }) {
    this.#checkProvider(provider);
    const count = Math.min(Math.max(Math.trunc(limit) || 100, 1), 500);
    const args = [
      'board --json',
      `--limit ${count}`,
      ...(jql.trim() ? [`--jql ${shellQuote(jql.trim())}`] : []),
      ...(summarize ? ['--summarize', `--provider ${provider}`] : []),
    ];
    const report = await this.#json(args.join(' '));
    const id = new Date().toISOString().replace(/[:.]/g, '-');
    await mkdir(this.boardDir, { recursive: true });
    await writeFile(join(this.boardDir, `${id}.json`), JSON.stringify(report, null, 2));
    return { id, ...report };
  }

  /** Saved board reports, newest first. */
  async boardReports() {
    if (!existsSync(this.boardDir)) return [];
    const files = (await readdir(this.boardDir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    return Promise.all(
      files.slice(0, 30).map(async (file) => {
        const report = JSON.parse(await readFile(join(this.boardDir, file), 'utf8'));
        return {
          id: file.replace(/\.json$/, ''),
          jql: report.jql,
          generatedAt: report.generated_at,
          issues: report.issues?.length ?? 0,
          stale: report.stale?.length ?? 0,
          summarized: Boolean(report.summary),
        };
      }),
    );
  }

  /** @param {string} id */
  async boardReport(id) {
    if (!/^[\w-]+$/.test(id)) return undefined;
    try {
      return { id, ...JSON.parse(await readFile(join(this.boardDir, `${id}.json`), 'utf8')) };
    } catch {
      return undefined;
    }
  }

  async clearBoardReports() {
    await rm(this.boardDir, { recursive: true, force: true });
  }

  get repo() {
    return expandHome(this.config.ai.repo);
  }

  /** @param {number} limit */
  async commits(limit) {
    const { code, stdout, stderr } = await this.run(
      `git log -n ${Math.min(Math.max(limit, 1), 100)} --format=%H%x1f%an%x1f%aI%x1f%s`,
      { cwd: this.repo, timeoutMs: 10_000 },
    );
    if (code !== 0) throw new Error(stderr.trim() || 'git log failed');
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sha = '', author = '', date = '', subject = ''] = line.split('\x1f');
        return { sha, author, date, subject };
      });
  }

  /**
   * Reviews one commit (with its Jira tickets) or the uncommitted changes.
   *
   * @param {{ sha?: string, provider?: string }} request
   */
  async review({ sha, provider = this.config.ai.provider }) {
    if (sha && !/^[0-9a-f]{7,40}$/i.test(sha)) {
      throw Object.assign(new Error('Invalid commit'), { statusCode: 400 });
    }
    if (!['openai', 'anthropic'].includes(provider)) {
      throw Object.assign(new Error('Unknown provider'), { statusCode: 400 });
    }
    const args = sha ? `commit ${sha}` : 'review';
    const { code, stdout, stderr } = await this.run(
      `${aiCommand(this.config)} ${args} --json --no-strict --provider ${provider}`,
      { cwd: this.repo, timeoutMs: 5 * 60_000 },
    );
    if (code !== 0) {
      throw Object.assign(new Error(lastLine(stderr) || `dops-ai exited with ${code}`), {
        statusCode: 502,
      });
    }
    let subject = 'Uncommitted changes';
    if (sha) {
      const log = await this.run(`git log -1 --format=%s ${sha}`, {
        cwd: this.repo,
        timeoutMs: 10_000,
      });
      subject = log.stdout.trim() || sha;
    }
    const createdAt = new Date().toISOString();
    const record = {
      id: `${createdAt.replace(/[:.]/g, '-')}-${sha ? sha.slice(0, 8) : 'worktree'}`,
      sha: sha ?? null,
      subject,
      provider,
      createdAt,
      review: JSON.parse(stdout),
    };
    await mkdir(this.storeDir, { recursive: true });
    await writeFile(join(this.storeDir, `${record.id}.json`), JSON.stringify(record, null, 2));
    return record;
  }

  /** Saved reviews, newest first, without the findings. */
  async reviews() {
    if (!existsSync(this.storeDir)) return [];
    const files = (await readdir(this.storeDir))
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();
    return Promise.all(
      files.slice(0, 50).map(async (file) => {
        const record = JSON.parse(await readFile(join(this.storeDir, file), 'utf8'));
        return {
          id: record.id,
          sha: record.sha,
          subject: record.subject,
          provider: record.provider,
          createdAt: record.createdAt,
          verdict: record.review?.verdict,
          findings: record.review?.findings?.length ?? 0,
        };
      }),
    );
  }

  /** @param {string} id */
  async get(id) {
    if (!/^[\w-]+$/.test(id)) return undefined;
    try {
      return JSON.parse(await readFile(join(this.storeDir, `${id}.json`), 'utf8'));
    } catch {
      return undefined;
    }
  }
}

/** @param {string} text */
function lastLine(text) {
  return text.trim().split('\n').filter(Boolean).at(-1) ?? '';
}
