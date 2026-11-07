import { useState } from 'react';

/** @import { Api, IssueDetailsInfo } from '../api.js' */

const ANALYSIS_SECTIONS = /** @type {const} */ ([
  ['acceptance_criteria', 'Acceptance criteria'],
  ['technical_notes', 'Technical notes'],
  ['risks', 'Risks'],
  ['questions', 'Questions to ask'],
  ['suggested_steps', 'Suggested steps'],
]);

/**
 * Read a Jira issue with its comments and related issues, and optionally an
 * AI analysis, before starting work on it.
 *
 * @param {{ api: Api }} props
 */
export function Jira({ api }) {
  const [key, setKey] = useState('');
  const [related, setRelated] = useState(true);
  const [analyze, setAnalyze] = useState(false);
  const [provider, setProvider] = useState('openai');
  const [details, setDetails] = useState(/** @type {IssueDetailsInfo | null} */ (null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  /** @param {import('react').FormEvent} event */
  async function load(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      setDetails(await api.jiraIssue({ key: key.trim(), related, analyze, provider }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const issue = details?.issue;
  return (
    <section>
      <form className="card" onSubmit={load}>
        <div className="row">
          <label className="field">
            <span>Issue key</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="SHOP-42" />
          </label>
          <label>
            <input
              type="checkbox"
              checked={related}
              onChange={(e) => setRelated(e.target.checked)}
            />{' '}
            Linked issues and subtasks
          </label>
          <label>
            <input
              type="checkbox"
              checked={analyze}
              onChange={(e) => setAnalyze(e.target.checked)}
            />{' '}
            AI analysis
          </label>
          {analyze && (
            <select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Claude</option>
            </select>
          )}
          <button type="submit" disabled={busy || !/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(key.trim())}>
            {busy ? 'Loading…' : 'Load'}
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      {details && issue && (
        <>
          <div className="card issue-card">
            <div className="row">
              <a href={details.url} target="_blank" rel="noreferrer">
                <strong>{issue.key}</strong>
              </a>
              <strong>{issue.summary}</strong>
            </div>
            <span className="muted">
              {[issue.issue_type, issue.status, issue.priority, issue.assignee ?? 'unassigned']
                .filter(Boolean)
                .join(' · ')}
              {issue.labels.length > 0 && ` · ${issue.labels.join(', ')}`}
            </span>
            {issue.description && <p className="prewrap">{issue.description}</p>}
          </div>

          {details.analysis && (
            <div className="card analysis">
              <strong>Analysis</strong>
              <p>{details.analysis.summary}</p>
              {ANALYSIS_SECTIONS.map(([field, title]) =>
                details.analysis?.[field].length ? (
                  <div key={field}>
                    <h4>{title}</h4>
                    <ul>
                      {details.analysis[field].map((item, index) => (
                        <li key={index}>{item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          )}

          {details.related.length > 0 && (
            <div className="card">
              <strong>Related issues</strong>
              <ul className="plain">
                {details.related.map((other) => (
                  <li key={other.key}>
                    <code>{other.key}</code> <span className="muted">{other.status}</span>{' '}
                    {other.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {details.comments.length > 0 && (
            <div className="card">
              <strong>Comments ({details.comments.length})</strong>
              <ul className="plain comments">
                {details.comments.map((comment, index) => (
                  <li key={index}>
                    <span className="muted small">
                      {comment.author}
                      {comment.created && ` · ${new Date(comment.created).toLocaleString()}`}
                    </span>
                    <p className="prewrap">{comment.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {details.raw && (
            <details className="card">
              <summary>Raw data</summary>
              <pre>{JSON.stringify(details.raw, null, 2)}</pre>
            </details>
          )}
        </>
      )}
    </section>
  );
}
