import { useEffect, useState } from 'react';

/** @import { Api } from '../api.js' */

/**
 * @typedef {object} RunSummary
 * @property {string} id
 * @property {string} pipeline
 * @property {string[]} targets
 * @property {string} status
 * @property {string} [site]
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 */

/** @param {RunSummary} run */
function duration(run) {
  if (!run.startedAt || !run.finishedAt) return '';
  const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
  return seconds < 60 ? `${seconds.toFixed(0)}s` : `${Math.round(seconds / 60)}m`;
}

/**
 * @param {{ api: Api, onOpen: (runId: string) => void }} props
 */
export function History({ api, onOpen }) {
  const [runs, setRuns] = useState(/** @type {RunSummary[]} */ ([]));
  const [error, setError] = useState('');

  useEffect(() => {
    api.runs().then(setRuns, (e) => setError(e.message));
  }, [api]);

  return (
    <section>
      {error && <p className="error">{error}</p>}
      {!runs.length && !error && <p className="muted">No runs yet.</p>}
      <table className="history">
        <thead>
          <tr>
            <th>Started</th>
            <th>Pipeline</th>
            <th>Targets</th>
            <th>Status</th>
            <th>Took</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} onClick={() => onOpen(run.id)}>
              <td>{run.startedAt ? new Date(run.startedAt).toLocaleString() : 'now'}</td>
              <td>
                {run.pipeline}
                {run.site && <span className="muted"> · {run.site}</span>}
              </td>
              <td>{run.targets.join(', ')}</td>
              <td>
                <span className={`status ${run.status}`}>{run.status}</span>
              </td>
              <td className="muted">{duration(run)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
