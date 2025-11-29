import { useEffect, useState } from 'react';

/**
 * @import { Api, PipelineInfo, TargetInfo } from '../api.js'
 */

/**
 * One pipeline card: choose targets and a site, then start a run.
 *
 * @param {{ pipeline: PipelineInfo, targets: TargetInfo[], sites: string[],
 *   onRun: (body: { pipeline: string, targets: string[], site?: string }) => Promise<void> }} props
 */
function PipelineCard({ pipeline, targets, sites, onRun }) {
  const [selected, setSelected] = useState(pipeline.targets);
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const needsSite = pipeline.steps.some((step) =>
    /(?<!\$)\{(?!target|environment|path)\w+\}/.test(step.run),
  );

  /** @param {string} name */
  const toggle = (name) =>
    setSelected((current) =>
      current.includes(name) ? current.filter((t) => t !== name) : [...current, name],
    );

  async function run() {
    setBusy(true);
    try {
      await onRun({ pipeline: pipeline.name, targets: selected, ...(site ? { site } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card">
      <strong>{pipeline.name}</strong>
      {pipeline.description && <span className="muted">{pipeline.description}</span>}
      <ol className="steps-preview">
        {pipeline.steps.map((step) => (
          <li key={step.name} title={step.run}>
            {step.name}
          </li>
        ))}
      </ol>
      <fieldset>
        <legend className="muted">Targets</legend>
        {targets.map((target) => (
          <label key={target.name}>
            <input
              type="checkbox"
              checked={selected.includes(target.name)}
              onChange={() => toggle(target.name)}
            />{' '}
            {target.name}
            {target.environment && <span className="muted"> · {target.environment}</span>}
          </label>
        ))}
      </fieldset>
      {sites.length > 0 && (
        <select value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">{needsSite ? 'Choose a site…' : 'No site'}</option>
          {sites.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      )}
      <button onClick={run} disabled={busy || !selected.length || (needsSite && !site)}>
        {busy ? 'Starting…' : 'Run'}
      </button>
    </li>
  );
}

/**
 * @param {{ api: Api, onStarted: (runId: string) => void }} props
 */
export function Pipelines({ api, onStarted }) {
  const [pipelines, setPipelines] = useState(/** @type {PipelineInfo[]} */ ([]));
  const [targets, setTargets] = useState(/** @type {TargetInfo[]} */ ([]));
  const [sites, setSites] = useState(/** @type {string[]} */ ([]));
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.pipelines(), api.targets(), api.sites()]).then(
      ([p, t, s]) => {
        setPipelines(p);
        setTargets(t);
        setSites(s);
      },
      (e) => setError(e.message),
    );
  }, [api]);

  /** @param {{ pipeline: string, targets: string[], site?: string }} body */
  async function onRun(body) {
    setError('');
    try {
      const { id } = await api.startRun(body);
      onStarted(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Pipelines</h2>
      {error && <p className="error">{error}</p>}
      <ul className="cards">
        {pipelines.map((pipeline) => (
          <PipelineCard
            key={pipeline.name}
            pipeline={pipeline}
            targets={targets}
            sites={sites}
            onRun={onRun}
          />
        ))}
      </ul>
    </section>
  );
}
