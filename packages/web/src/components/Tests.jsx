import { useCallback, useEffect, useState } from 'react';

/** @import { Api, TestRunInfo, TestSuiteInfo } from '../api.js' */

/** @param {TestRunInfo} run */
function counts(run) {
  if (!run.stats) return run.error ?? '';
  const { passed, failed, flaky, skipped } = run.stats;
  return [
    `${passed} passed`,
    failed && `${failed} failed`,
    flaky && `${flaky} flaky`,
    skipped && `${skipped} skipped`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * UI test suites: start a run, follow its status and open the Playwright report.
 *
 * @param {{ api: Api }} props
 */
export function Tests({ api }) {
  const [suites, setSuites] = useState(/** @type {TestSuiteInfo[]} */ ([]));
  const [runs, setRuns] = useState(/** @type {TestRunInfo[]} */ ([]));
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextSuites, nextRuns] = await Promise.all([api.testSuites(), api.testRuns()]);
      setSuites(nextSuites);
      setRuns(nextRuns);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  const running = suites.some((suite) => suite.running);
  useEffect(() => {
    void refresh();
    if (!running) return undefined;
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh, running]);

  /** @param {string} name */
  async function start(name) {
    try {
      await api.startTests(name);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>UI tests</h2>
      {error && <p className="error">{error}</p>}
      {!suites.length && !error && (
        <p className="muted">
          No suites configured. Add <code>uiTests.suites</code> to the config.
        </p>
      )}
      <ul className="cards">
        {suites.map((suite) => (
          <li key={suite.name} className="card">
            <strong>{suite.name}</strong>
            <span className="muted">{suite.baseUrl}</span>
            {suite.schedules.length > 0 && (
              <span className="muted">schedule: {suite.schedules.join(', ')}</span>
            )}
            <button disabled={suite.running} onClick={() => start(suite.name)}>
              {suite.running ? 'Running…' : 'Run now'}
            </button>
          </li>
        ))}
      </ul>

      {runs.length > 0 && (
        <table className="history">
          <thead>
            <tr>
              <th>Started</th>
              <th>Suite</th>
              <th>Status</th>
              <th>Result</th>
              <th>Report</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="static">
                <td>{new Date(run.startedAt).toLocaleString()}</td>
                <td>{run.suite}</td>
                <td>
                  <span className={`status ${run.status}`}>{run.status}</span>
                </td>
                <td>
                  {counts(run)}
                  {run.failures.map((failure) => (
                    <div key={`${failure.file}:${failure.line}`} className="failure">
                      ✖ {failure.title} <span className="muted">{failure.error}</span>
                    </div>
                  ))}
                </td>
                <td>
                  {run.reportUrl && (
                    <a href={run.reportUrl} target="_blank" rel="noreferrer">
                      open
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
