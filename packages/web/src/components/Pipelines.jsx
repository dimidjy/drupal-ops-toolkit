import { useEffect, useState } from 'react';
import { QuickCommand } from './QuickCommand.jsx';

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
  const [selected, setSelected] = useState(
    pipeline.targets.filter((name) => targets.some((t) => t.name === name)),
  );
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
 * Remote scope: SSH targets and their pipelines. Local scope: targets with
 * `local: true` (commands on this machine) and pipelines that only use them.
 *
 * @param {{ api: Api, onStarted: (runId: string) => void, scope?: 'remote' | 'local' }} props
 */
export function Pipelines({ api, onStarted, scope = 'remote' }) {
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

  const isLocal = (/** @type {string} */ name) =>
    targets.find((t) => t.name === name)?.host === 'local';
  const scoped = targets.filter((t) => (t.host === 'local') === (scope === 'local'));
  const shown = pipelines.filter(
    (p) => p.targets.every(isLocal) === (scope === 'local') || !targets.length,
  );

  return (
    <section>
      <h2>{scope === 'local' ? 'Local' : 'Pipelines'}</h2>
      {error && <p className="error">{error}</p>}
      {scope === 'local' && !scoped.length && !error ? (
        <p className="muted">
          No local targets. Add one with <code>local: true</code> and a <code>path</code> to the
          config.
        </p>
      ) : (
        <QuickCommand
          api={api}
          targets={scoped}
          sites={sites}
          title={scope === 'local' ? 'Command on this machine' : 'Quick command'}
          placeholder={scope === 'local' ? 'ddev drush cr' : 'vendor/bin/drush {alias} status'}
          onStarted={onStarted}
        />
      )}
      <ul className="cards">
        {shown.map((pipeline) => (
          <PipelineCard
            key={pipeline.name}
            pipeline={pipeline}
            targets={scoped}
            sites={sites}
            onRun={onRun}
          />
        ))}
      </ul>
    </section>
  );
}
