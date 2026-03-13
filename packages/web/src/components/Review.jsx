import { useCallback, useEffect, useState } from 'react';

/** @import { Api, ReviewRecord } from '../api.js' */

const SEVERITY_ORDER = ['critical', 'major', 'minor', 'info'];
const VERDICT = {
  approve: ['ok', 'approve'],
  comment: ['warn', 'comment'],
  request_changes: ['failed', 'request changes'],
};

/** @param {{ record: ReviewRecord }} props */
export function ReviewResult({ record }) {
  const [className, label] = VERDICT[record.review.verdict] ?? ['', record.review.verdict];
  const findings = [...record.review.findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
  return (
    <div className="card review-result">
      <div className="row">
        <strong>{record.subject}</strong>
        <span className={`status ${className}`}>{label}</span>
        <span className="muted small">
          {record.sha?.slice(0, 8) ?? 'working tree'} · {record.provider} ·{' '}
          {new Date(record.createdAt).toLocaleString()}
        </span>
      </div>
      <p>{record.review.summary}</p>
      {findings.length > 0 && (
        <table className="history">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Where</th>
              <th>Finding</th>
            </tr>
          </thead>
          <tbody>
            {findings.map((finding, index) => (
              <tr key={index} className="static">
                <td>
                  <span className={`severity ${finding.severity}`}>{finding.severity}</span>
                </td>
                <td>
                  <code>
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ''}
                  </code>
                </td>
                <td>{finding.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * AI review of a recent commit (checked against its Jira tickets) or of the
 * uncommitted changes, plus the reviews done before.
 *
 * @param {{ api: Api }} props
 */
export function Review({ api }) {
  const [commits, setCommits] = useState(/** @type {Awaited<ReturnType<Api['commits']>>} */ ([]));
  const [history, setHistory] = useState(/** @type {Awaited<ReturnType<Api['reviews']>>} */ ([]));
  const [selected, setSelected] = useState('');
  const [provider, setProvider] = useState('openai');
  const [record, setRecord] = useState(/** @type {ReviewRecord | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [c, h] = await Promise.all([api.commits(15), api.reviews()]);
    setCommits(c);
    setHistory(h);
  }, [api]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  /** @param {string} [sha] */
  async function run(sha) {
    setBusy(true);
    setError('');
    setRecord(null);
    try {
      setRecord(await api.reviewCommit({ ...(sha ? { sha } : {}), provider }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Commit review</h2>
      <div className="card">
        <strong>Recent commits</strong>
        <ul className="commit-list">
          {commits.map((commit) => (
            <li key={commit.sha}>
              <label>
                <input
                  type="radio"
                  name="commit"
                  checked={selected === commit.sha}
                  onChange={() => setSelected(commit.sha)}
                />{' '}
                <code>{commit.sha.slice(0, 8)}</code> {commit.subject}
                <span className="muted small">
                  {' '}
                  · {commit.author} · {new Date(commit.date).toLocaleDateString()}
                </span>
              </label>
            </li>
          ))}
        </ul>
        <div className="row">
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="openai">OpenAI</option>
            <option value="anthropic">Claude</option>
          </select>
          <button disabled={busy || !selected} onClick={() => run(selected)}>
            {busy ? 'Reviewing…' : 'Review commit'}
          </button>
          <button className="secondary" disabled={busy} onClick={() => run()}>
            Review uncommitted changes
          </button>
          <span className="muted small">
            Jira issues named in the commit message are loaded and checked too.
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {record && <ReviewResult record={record} />}

      {history.length > 0 && (
        <>
          <h3>Recent reviews</h3>
          <table className="history">
            <thead>
              <tr>
                <th>When</th>
                <th>Commit</th>
                <th>Verdict</th>
                <th>Findings</th>
              </tr>
            </thead>
            <tbody>
              {history.map((item) => (
                <tr key={item.id} onClick={() => api.review(item.id).then(setRecord)}>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <code>{item.sha?.slice(0, 8) ?? 'worktree'}</code> {item.subject}
                  </td>
                  <td>
                    <span
                      className={`status ${VERDICT[/** @type {keyof typeof VERDICT} */ (item.verdict)]?.[0] ?? ''}`}
                    >
                      {item.verdict?.replace('_', ' ')}
                    </span>
                  </td>
                  <td>{item.findings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
