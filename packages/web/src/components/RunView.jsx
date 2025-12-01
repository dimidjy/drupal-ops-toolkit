import { useEffect, useReducer, useState } from 'react';
import { initialRunView, runReducer } from '../runState.js';

/** @import { Api } from '../api.js' */

const ICON = { running: '⏳', ok: '✔', failed: '✖', skipped: '–' };

/**
 * Live view of one run: steps per target with their output. For finished runs
 * the stored log is shown instead.
 *
 * @param {{ api: Api, runId: string, onClose: () => void }} props
 */
export function RunView({ api, runId, onClose }) {
  const [view, dispatch] = useReducer(runReducer, initialRunView);
  const [log, setLog] = useState('');

  useEffect(() => api.streamRun(runId, dispatch), [api, runId]);

  const finished = ['ok', 'failed', 'cancelled'].includes(view.status);
  const hasLiveOutput = view.steps.some((step) => step.output);
  useEffect(() => {
    if (finished && !hasLiveOutput) {
      api.runLog(runId).then(setLog, () => setLog(''));
    }
  }, [api, runId, finished, hasLiveOutput]);

  return (
    <section className="run-view">
      <div className="run-header">
        <h2>
          {view.pipeline || 'Run'} <span className={`status ${view.status}`}>{view.status}</span>
        </h2>
        <span className="muted">
          {view.targets.join(', ')} · <code>{runId}</code>
        </span>
        <div className="actions">
          {view.status === 'running' && (
            <button className="danger" onClick={() => api.cancelRun(runId)}>
              Cancel
            </button>
          )}
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
      {view.status === 'unknown' && <p className="error">No run with this id.</p>}
      <ol className="run-steps">
        {view.steps.map((step) => (
          <li key={step.key} className={step.status}>
            <details open={step.status === 'running' || step.status === 'failed'}>
              <summary>
                <span className="icon">{ICON[step.status]}</span>
                <span className="muted">[{step.target}]</span> {step.name}
                {step.durationMs !== undefined && step.status !== 'skipped' && (
                  <span className="muted"> · {(step.durationMs / 1000).toFixed(1)}s</span>
                )}
              </summary>
              <pre>
                <span className="muted">$ {step.command}</span>
                {'\n'}
                {step.output}
              </pre>
            </details>
          </li>
        ))}
      </ol>
      {log && (
        <details open>
          <summary>Full output</summary>
          <pre>{log}</pre>
        </details>
      )}
    </section>
  );
}
