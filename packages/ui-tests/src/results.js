import { stripVTControlCharacters } from 'node:util';

/**
 * Reading Playwright's JSON reporter output.
 *
 * @typedef {object} Failure
 * @property {string} title  "describe › test"
 * @property {string} file
 * @property {number} line
 * @property {string} error  First line of the error message.
 *
 * @typedef {object} Stats
 * @property {number} passed
 * @property {number} failed
 * @property {number} flaky
 * @property {number} skipped
 * @property {number} durationMs
 */

/**
 * @typedef {object} JsonSpec
 * @property {string} title
 * @property {string} file
 * @property {number} line
 * @property {{ status: string, results: { error?: { message?: string } }[] }[]} tests
 *
 * @typedef {object} JsonSuite
 * @property {string} title
 * @property {JsonSpec[]} [specs]
 * @property {JsonSuite[]} [suites]
 */

/**
 * @param {JsonSuite[]} suites
 * @param {string[]} parents
 * @param {Failure[]} failures
 */
function collectFailures(suites, parents, failures) {
  for (const suite of suites) {
    // Top-level suites are files; their title is the path, not a describe().
    const path =
      parents.length || !suite.title.match(/\.(spec|test)\.[cm]?[jt]s$/)
        ? [...parents, suite.title]
        : parents;
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status !== 'unexpected') continue;
        const message = test.results.at(-1)?.error?.message ?? 'failed';
        failures.push({
          title: [...path, spec.title].filter(Boolean).join(' › '),
          file: spec.file,
          line: spec.line,
          error: stripVTControlCharacters(message).trim().split('\n')[0] ?? 'failed',
        });
      }
    }
    collectFailures(suite.suites ?? [], path, failures);
  }
}

/**
 * @param {{ stats: { expected: number, unexpected: number, flaky: number, skipped: number, duration: number }, suites: JsonSuite[] }} report
 * @returns {{ stats: Stats, failures: Failure[] }}
 */
export function summarizeReport(report) {
  /** @type {Failure[]} */
  const failures = [];
  collectFailures(report.suites, [], failures);
  return {
    stats: {
      passed: report.stats.expected,
      failed: report.stats.unexpected,
      flaky: report.stats.flaky,
      skipped: report.stats.skipped,
      durationMs: Math.round(report.stats.duration),
    },
    failures,
  };
}
