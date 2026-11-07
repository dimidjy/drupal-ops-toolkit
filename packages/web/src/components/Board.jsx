import { useCallback, useEffect, useState } from 'react';

/** @import { Api, BoardReportInfo, JiraIssueInfo } from '../api.js' */

const JQL_KEY = 'dops-board-jql';

/** @param {JiraIssueInfo[]} issues */
function byStatus(issues) {
  /** @type {Record<string, JiraIssueInfo[]>} */
  const groups = {};
  for (const issue of issues) (groups[issue.status] ??= []).push(issue);
  return Object.entries(groups);
}

/**
 * Days between the last update and when the report was made.
 *
 * @param {string | null | undefined} iso
 * @param {string} at
 */
function idleDays(iso, at) {
  return iso ? Math.max(0, Math.floor((Date.parse(at) - Date.parse(iso)) / 86_400_000)) : null;
}

/** @param {{ report: BoardReportInfo }} props */
function BoardReport({ report }) {
  const stale = new Set(report.stale);
  return (
    <>
      <div className="summary-bar">
        <strong>{report.issues.length} issues</strong>
        {Object.entries(report.counts).map(([status, count]) => (
          <span key={status} className="muted">
            {status}: {count}
          </span>
        ))}
        {report.stale.length > 0 && <span className="warn-text">{report.stale.length} stale</span>}
        <span className="muted small">{new Date(report.generated_at).toLocaleString()}</span>
      </div>
      {report.summary && (
        <div className="card analysis">
          <strong>Summary</strong>
          <p>{report.summary.summary}</p>
          {report.summary.risks.length > 0 && (
            <>
              <h4>Risks</h4>
              <ul>
                {report.summary.risks.map((risk, index) => (
                  <li key={index}>{risk}</li>
                ))}
              </ul>
            </>
          )}
          {report.summary.blocked.length > 0 && (
            <p>
              <span className="error">Blocked:</span> {report.summary.blocked.join(', ')}
            </p>
          )}
        </div>
      )}
      {byStatus(report.issues).map(([status, issues]) => (
        <div key={status} className="board-group">
          <h3>
            {status} <span className="muted">({issues.length})</span>
          </h3>
          <table className="history board-table">
            <colgroup>
              <col className="key" />
              <col />
              <col className="type" />
              <col className="priority" />
              <col className="assignee" />
              <col className="idle" />
            </colgroup>
            <tbody>
              {issues.map((issue) => {
                const idle = idleDays(issue.updated, report.generated_at);
                return (
                  <tr key={issue.key} className="static">
                    <td>
                      <code>{issue.key}</code>
                    </td>
                    <td>{issue.summary}</td>
                    <td className="muted">{issue.issue_type}</td>
                    <td className="muted">{issue.priority}</td>
                    <td>{issue.assignee ?? <span className="muted">unassigned</span>}</td>
                    <td className={stale.has(issue.key) ? 'error' : 'muted'}>
                      {idle === null ? '' : `${idle}d`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

/**
 * Board overview for a JQL query with an optional AI stand-up summary;
 * every run is kept as a report.
 *
 * @param {{ api: Api, view?: 'board' | 'history' }} props
 */
export function Board({ api, view = 'board' }) {
  const [jql, setJql] = useState(() => {
    try {
      return localStorage.getItem(JQL_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [limit, setLimit] = useState(100);
  const [summarize, setSummarize] = useState(true);
  const [provider, setProvider] = useState('openai');
  const [report, setReport] = useState(/** @type {BoardReportInfo | null} */ (null));
  const [reports, setReports] = useState(
    /** @type {Awaited<ReturnType<Api['boardReports']>>} */ ([]),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => api.boardReports().then(setReports), [api]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  async function run() {
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(JQL_KEY, jql);
    } catch {
      // Only a convenience.
    }
    try {
      setReport(await api.jiraBoard({ jql, limit, summarize, provider }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    if (!window.confirm('Delete all saved board reports?')) return;
    await api.clearBoardReports();
    setReport(null);
    await load();
  }

  return (
    <section>
      {view === 'board' && (
        <div className="card">
          <label className="field">
            <span>JQL (empty: DOPS_JIRA_JQL)</span>
            <textarea
              rows={2}
              value={jql}
              onChange={(e) => setJql(e.target.value)}
              placeholder="project = SHOP AND sprint in openSprints() ORDER BY status"
              spellCheck={false}
            />
          </label>
          <div className="row">
            <label className="field">
              <span>Max issues</span>
              <input
                type="number"
                className="narrow"
                min={1}
                max={500}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={summarize}
                onChange={(e) => setSummarize(e.target.checked)}
              />{' '}
              AI summary
            </label>
            {summarize && (
              <select value={provider} onChange={(e) => setProvider(e.target.value)}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Claude</option>
              </select>
            )}
            <button disabled={busy} onClick={run}>
              {busy ? 'Loading…' : 'Run'}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </div>
      )}
      {view === 'history' && error && <p className="error">{error}</p>}

      {report && <BoardReport report={report} />}

      {view === 'history' && !reports.length && !error && (
        <p className="muted">No board reports yet.</p>
      )}
      {view === 'history' && reports.length > 0 && (
        <>
          <div className="row">
            <button className="link danger-text" onClick={clear}>
              Clear all reports
            </button>
          </div>
          <table className="history">
            <tbody>
              {reports.map((item) => (
                <tr key={item.id} onClick={() => api.boardReport(item.id).then(setReport)}>
                  <td>{new Date(item.generatedAt).toLocaleString()}</td>
                  <td>
                    <code>{item.jql}</code>
                  </td>
                  <td>{item.issues} issues</td>
                  <td className={item.stale ? 'warn-text' : 'muted'}>{item.stale} stale</td>
                  <td className="muted">{item.summarized ? 'with summary' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
