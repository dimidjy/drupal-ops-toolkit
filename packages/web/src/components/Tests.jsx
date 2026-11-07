import { useCallback, useEffect, useState } from 'react';
import { describeCron, toCron } from '../cron.js';

/** @import { Api, ScheduleInfo, TestRunInfo, TestRunRequest, TestSuiteInfo } from '../api.js' */
/** @import { When } from '../cron.js' */

const BROWSERS = /** @type {const} */ (['chromium', 'firefox', 'webkit', 'mobile']);

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

/** @param {{ suite: string, testFile?: string, environment?: string, browser?: string, urls?: string[] }} what */
function describeRun(what) {
  return [
    what.suite + (what.testFile ? ` / ${what.testFile}` : ''),
    what.environment,
    what.browser && what.browser !== 'chromium' ? what.browser : '',
    what.urls?.length ? `${what.urls.length} URL(s)` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * UI tests: run a suite or one spec file against an environment, with a URL
 * list and a browser, follow it, open its report, and schedule it.
 *
 * @param {{ api: Api, view?: 'run' | 'schedules' | 'history' }} props
 */
export function Tests({ api, view = 'run' }) {
  const [suites, setSuites] = useState(/** @type {TestSuiteInfo[]} */ ([]));
  const [runs, setRuns] = useState(/** @type {TestRunInfo[]} */ ([]));
  const [schedules, setSchedules] = useState(/** @type {ScheduleInfo[]} */ ([]));
  const [form, setForm] = useState({
    suite: '',
    testFile: '',
    environment: '',
    browser: /** @type {(typeof BROWSERS)[number]} */ ('chromium'),
    urls: '',
  });
  const [when, setWhen] = useState(/** @type {When} */ ({ mode: 'weekdays', time: '07:00' }));
  const [scheduleName, setScheduleName] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [nextSuites, nextRuns, nextSchedules] = await Promise.all([
        api.testSuites(),
        api.testRuns(),
        api.schedules(),
      ]);
      setSuites(nextSuites);
      setRuns(nextRuns);
      setSchedules(nextSchedules);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  const running = suites.some((suite) => suite.running);
  useEffect(() => {
    void refresh();
    if (!running) return undefined;
    const timer = setInterval(refresh, 2000);
    return () => clearInterval(timer);
  }, [refresh, running]);

  const suite = suites.find((s) => s.name === form.suite) ?? suites[0];
  /** @returns {TestRunRequest} */
  const options = () => {
    const urls = form.urls
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      ...(form.testFile ? { testFile: form.testFile } : {}),
      ...(form.environment ? { environment: form.environment } : {}),
      ...(urls.length ? { urls } : {}),
      browser: form.browser,
    };
  };

  /** @param {() => Promise<unknown>} action */
  async function act(action) {
    setError('');
    try {
      await action();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      {!suites.length && !error && (
        <p className="muted">
          No suites configured. Add <code>uiTests.suites</code> to the config.
        </p>
      )}
      {view !== 'run' && error && <p className="error">{error}</p>}
      {view === 'run' && suite && (
        <div className="card">
          <strong>Run a test</strong>
          <div className="row">
            <label className="field">
              <span>Suite</span>
              <select
                value={suite.name}
                onChange={(e) =>
                  setForm({ ...form, suite: e.target.value, testFile: '', environment: '' })
                }
              >
                {suites.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Test</span>
              <select
                value={form.testFile}
                onChange={(e) => setForm({ ...form, testFile: e.target.value })}
              >
                <option value="">All tests</option>
                {suite.files.map((file) => (
                  <option key={file}>{file}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Environment</span>
              <select
                value={form.environment}
                onChange={(e) => setForm({ ...form, environment: e.target.value })}
              >
                <option value="">default · {suite.baseUrl}</option>
                {Object.entries(suite.environments).map(([name, url]) => (
                  <option key={name} value={name}>
                    {name} · {url}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Browser</span>
              <select
                value={form.browser}
                onChange={(e) =>
                  setForm({ ...form, browser: /** @type {typeof form.browser} */ (e.target.value) })
                }
              >
                {BROWSERS.map((browser) => (
                  <option key={browser}>{browser}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>URLs to run against (optional, one per line; specs read DOPS_TEST_URLS)</span>
            <textarea
              rows={3}
              spellCheck={false}
              value={form.urls}
              onChange={(e) => setForm({ ...form, urls: e.target.value })}
              placeholder={'/\n/user/login\n/products'}
            />
          </label>
          <div className="row">
            <button
              disabled={suite.running}
              onClick={() => act(() => api.startTests(suite.name, options()))}
            >
              {suite.running ? 'Running…' : 'Run'}
            </button>
            {suite.running && (
              <button className="danger" onClick={() => act(() => api.stopTests(suite.name))}>
                Stop
              </button>
            )}
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}

      {view === 'history' && !runs.length && !error && <p className="muted">No test runs yet.</p>}
      {view === 'history' && runs.length > 0 && (
        <>
          <table className="history">
            <thead>
              <tr>
                <th>Started</th>
                <th>What</th>
                <th>Status</th>
                <th>Result</th>
                <th>Report</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="static">
                  <td>
                    {new Date(run.startedAt).toLocaleString()}
                    {run.trigger?.startsWith('schedule:') && (
                      <div className="muted small">{run.trigger.slice('schedule:'.length)}</div>
                    )}
                  </td>
                  <td>{describeRun(run)}</td>
                  <td>
                    <span className={`status ${run.status}`}>{run.status}</span>
                  </td>
                  <td>
                    {counts(run)}
                    {run.failures.map((failure) => (
                      <div
                        key={`${failure.file}:${failure.line}:${failure.title}`}
                        className="failure"
                      >
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
        </>
      )}

      {view === 'schedules' && suite && (
        <>
          <div className="card">
            <strong>Schedule this run</strong>
            <span className="muted small">
              {describeRun({ suite: suite.name, ...options() })} · set the suite, test, environment
              and browser in the Run tab
            </span>
            <div className="row">
              <label className="field">
                <span>Name</span>
                <input
                  value={scheduleName}
                  onChange={(e) => setScheduleName(e.target.value)}
                  placeholder="Morning smoke on prod"
                />
              </label>
              <label className="field">
                <span>When</span>
                <select
                  value={when.mode}
                  onChange={(e) => {
                    const mode = e.target.value;
                    setWhen(
                      mode === 'every'
                        ? { mode, minutes: 60 }
                        : mode === 'cron'
                          ? { mode, expression: '0 7 * * 1-5' }
                          : { mode: /** @type {'daily' | 'weekdays'} */ (mode), time: '07:00' },
                    );
                  }}
                >
                  <option value="weekdays">Weekdays at</option>
                  <option value="daily">Every day at</option>
                  <option value="every">Every N minutes</option>
                  <option value="cron">Cron expression</option>
                </select>
              </label>
              {(when.mode === 'daily' || when.mode === 'weekdays') && (
                <label className="field">
                  <span>Time</span>
                  <input
                    type="time"
                    value={when.time}
                    onChange={(e) => setWhen({ ...when, time: e.target.value })}
                  />
                </label>
              )}
              {when.mode === 'every' && (
                <label className="field">
                  <span>Minutes</span>
                  <input
                    type="number"
                    className="narrow"
                    min={5}
                    max={59}
                    value={when.minutes}
                    onChange={(e) => setWhen({ ...when, minutes: Number(e.target.value) })}
                  />
                </label>
              )}
              {when.mode === 'cron' && (
                <label className="field">
                  <span>Cron</span>
                  <input
                    value={when.expression}
                    onChange={(e) => setWhen({ ...when, expression: e.target.value })}
                  />
                </label>
              )}
              <button
                className="secondary"
                onClick={() =>
                  act(() =>
                    api.addSchedule({
                      suite: suite.name,
                      cron: toCron(when),
                      ...(scheduleName.trim() ? { name: scheduleName.trim() } : {}),
                      ...options(),
                    }),
                  )
                }
              >
                Add schedule
              </button>
            </div>
            <span className="muted small">
              Schedules run while <code>dops serve</code> (or <code>dops test schedule</code>) is
              running.
            </span>
          </div>

          {schedules.length > 0 && (
            <table className="history">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>What</th>
                  <th>When</th>
                  <th>Next run</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="static">
                    <td>
                      {schedule.name ?? <span className="muted">—</span>}
                      {schedule.source === 'config' && (
                        <div className="muted small">config file</div>
                      )}
                    </td>
                    <td>{describeRun(schedule)}</td>
                    <td>{describeCron(schedule.cron)}</td>
                    <td className="muted">
                      {schedule.nextRun ? new Date(schedule.nextRun).toLocaleString() : '—'}
                    </td>
                    <td className="actions">
                      {schedule.source === 'dashboard' && (
                        <>
                          <label>
                            <input
                              type="checkbox"
                              checked={schedule.enabled}
                              onChange={(e) =>
                                act(() => api.toggleSchedule(schedule.id, e.target.checked))
                              }
                            />{' '}
                            on
                          </label>
                          <button
                            className="link danger-text"
                            onClick={() => act(() => api.deleteSchedule(schedule.id))}
                          >
                            delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
