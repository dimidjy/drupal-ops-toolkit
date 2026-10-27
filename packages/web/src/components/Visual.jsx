import { useEffect, useState } from 'react';

/** @import { Api, VisualReportInfo } from '../api.js' */

/**
 * Visual diff reports produced by `dops visual compare` and `dops visual ab`.
 *
 * @param {{ api: Api }} props
 */
export function Visual({ api }) {
  const [reports, setReports] = useState(/** @type {VisualReportInfo[]} */ ([]));
  const [error, setError] = useState('');

  useEffect(() => {
    api.visualReports().then(setReports, (e) => setError(e.message));
  }, [api]);

  return (
    <section>
      <h2>Visual reports</h2>
      {error && <p className="error">{error}</p>}
      {!reports.length && !error && (
        <p className="muted">
          No reports yet. Run <code>dops visual compare &lt;set&gt;</code> or{' '}
          <code>dops visual ab &lt;set&gt; prod stage</code>.
        </p>
      )}
      <ul className="cards">
        {reports.map((report) => (
          <li key={report.url} className="card">
            <strong>{report.set}</strong>
            <span>{report.name}</span>
            <span className="muted">{new Date(report.modifiedAt).toLocaleString()}</span>
            <a href={report.url} target="_blank" rel="noreferrer">
              Open report
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
