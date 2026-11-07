import { useEffect, useState } from 'react';
import { confirmProduction, productionNames } from '../production.js';
import { ParamFields, splitParams, useParamValues } from './ParamFields.jsx';
import { QuickCommand, TargetLabel } from './QuickCommand.jsx';

/**
 * @import { Api, PipelineInfo, TargetInfo } from '../api.js'
 * @import { ParamContext } from './ParamFields.jsx'
 */

/**
 * One pipeline card: choose targets, a site and parameter values, then start a run.
 *
 * @param {{ pipeline: PipelineInfo, targets: TargetInfo[], sites: string[], paramContext: ParamContext,
 *   onRun: (body: { pipeline: string, targets: string[], site?: string,
 *     params?: Record<string, string>, confirmProduction?: boolean }) => Promise<void> }} props
 */
function PipelineCard({ pipeline, targets, sites, paramContext, onRun }) {
  const [selected, setSelected] = useState(
    pipeline.targets.filter((name) => targets.some((t) => t.name === name)),
  );
  const [site, setSite] = useState('');
  const [busy, setBusy] = useState(false);
  const values = useParamValues(paramContext);
  const { needsSite, fields } = splitParams(pipeline.params, site, paramContext);
  const incomplete = fields.some((name) => !values.valueOf(name).trim());

  /** @param {string} name */
  const toggle = (name) =>
    setSelected((current) =>
      current.includes(name) ? current.filter((t) => t !== name) : [...current, name],
    );

  async function run() {
    const confirmed = confirmProduction(
      `pipeline "${pipeline.name}"`,
      productionNames(targets, selected),
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await onRun({
        pipeline: pipeline.name,
        targets: selected,
        ...(site ? { site } : {}),
        ...(fields.length ? { params: values.collect(fields) } : {}),
        ...confirmed,
      });
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
            <TargetLabel target={target} />
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
      <ParamFields names={fields} context={paramContext} values={values} />
      <button
        onClick={run}
        disabled={busy || !selected.length || (needsSite && !site) || incomplete}
      >
        {busy ? 'Starting…' : 'Run'}
      </button>
    </li>
  );
}

/**
 * Server targets and their pipelines. Local targets (`local: true`) are left to
 * the CLI, where `dops deploy` runs them.
 *
 * @param {{ api: Api, onStarted: (runId: string) => void }} props
 */
export function Pipelines({ api, onStarted }) {
  const [pipelines, setPipelines] = useState(/** @type {PipelineInfo[]} */ ([]));
  const [targets, setTargets] = useState(/** @type {TargetInfo[]} */ ([]));
  const [sites, setSites] = useState(/** @type {string[]} */ ([]));
  const [paramContext, setParamContext] = useState(
    /** @type {ParamContext} */ ({ definitions: [], siteParams: {} }),
  );
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.pipelines(), api.targets(), api.sites(), api.params(), api.siteParams()]).then(
      ([p, t, s, definitions, siteParams]) => {
        setPipelines(p);
        setTargets(t);
        setSites(s);
        setParamContext({ definitions, siteParams });
      },
      (e) => setError(e.message),
    );
  }, [api]);

  /** @param {{ pipeline: string, targets: string[], site?: string, params?: Record<string, string>, confirmProduction?: boolean }} body */
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
  const scoped = targets.filter((t) => t.host !== 'local');
  const shown = pipelines.filter((p) => !p.targets.every(isLocal) || !targets.length);

  return (
    <section>
      <h2>Pipelines</h2>
      {error && <p className="error">{error}</p>}
      <QuickCommand
        api={api}
        targets={scoped}
        sites={sites}
        paramContext={paramContext}
        onStarted={onStarted}
      />
      <ul className="cards">
        {shown.map((pipeline) => (
          <PipelineCard
            key={pipeline.name}
            pipeline={pipeline}
            targets={scoped}
            sites={sites}
            paramContext={paramContext}
            onRun={onRun}
          />
        ))}
      </ul>
    </section>
  );
}
