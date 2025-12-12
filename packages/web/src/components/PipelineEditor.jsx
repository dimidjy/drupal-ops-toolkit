import { useCallback, useEffect, useRef, useState } from 'react';
import { PIPELINES, STEPS } from '../templates.js';

/** @import { Api, PipelineInfo, StepInfo, TargetInfo, ParamInfo } from '../api.js' */

/** @typedef {{ name: string, description: string, targets: string[], steps: StepInfo[] }} Draft */

/** @returns {Draft} */
const emptyDraft = () => ({
  name: '',
  description: '',
  targets: [],
  steps: [{ name: '', run: '' }],
});

const BUILTIN = ['target', 'environment', 'path', 'site'];

/**
 * Create, edit, duplicate and delete pipelines kept in the dashboard workspace.
 * Pipelines from the config file are read-only here but can be duplicated.
 *
 * @param {{ api: Api }} props
 */
export function PipelineEditor({ api }) {
  const [pipelines, setPipelines] = useState(/** @type {PipelineInfo[]} */ ([]));
  const [targets, setTargets] = useState(/** @type {TargetInfo[]} */ ([]));
  const [params, setParams] = useState(/** @type {ParamInfo[]} */ ([]));
  const [siteKeys, setSiteKeys] = useState(/** @type {string[]} */ ([]));
  const [draft, setDraft] = useState(emptyDraft);
  const [editing, setEditing] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lastField = useRef(/** @type {{ index: number, el: HTMLTextAreaElement } | null} */ (null));

  const load = useCallback(async () => {
    const [p, t, definitions, siteParams] = await Promise.all([
      api.pipelines(),
      api.targets(),
      api.params(),
      api.siteParams(),
    ]);
    setPipelines(p);
    setTargets(t);
    setParams(definitions);
    setSiteKeys([...new Set(Object.values(siteParams).flat())]);
  }, [api]);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  /** @param {Partial<Draft>} patch */
  const update = (patch) => setDraft((current) => ({ ...current, ...patch }));
  /**
   * @param {number} index
   * @param {Partial<StepInfo>} patch
   */
  const updateStep = (index, patch) =>
    update({ steps: draft.steps.map((step, i) => (i === index ? { ...step, ...patch } : step)) });
  /**
   * @param {number} index
   * @param {number} by
   */
  const moveStep = (index, by) => {
    const steps = [...draft.steps];
    const [step] = steps.splice(index, 1);
    if (step) steps.splice(index + by, 0, step);
    update({ steps });
  };

  /** @param {string} placeholder */
  function insert(placeholder) {
    const field = lastField.current;
    if (!field) return;
    const { index, el } = field;
    const value = draft.steps[index]?.run ?? '';
    const at = el.selectionStart ?? value.length;
    updateStep(index, { run: `${value.slice(0, at)}{${placeholder}}${value.slice(at)}` });
    requestAnimationFrame(() => el.focus());
  }

  /** @param {string[]} keys */
  const stepsFrom = (keys) => keys.flatMap((key) => (STEPS[key] ? [{ ...STEPS[key] }] : []));

  /**
   * @param {PipelineInfo} pipeline
   * @param {boolean} copy
   */
  function open(pipeline, copy) {
    setDraft({
      name: copy ? `${pipeline.name}-copy` : pipeline.name,
      description: pipeline.description ?? '',
      targets: pipeline.targets,
      steps: pipeline.steps.map((step) => ({ ...step })),
    });
    setEditing(copy ? '' : pipeline.name);
    setMessage('');
    setError('');
  }

  async function save() {
    setError('');
    setMessage('');
    try {
      await api.savePipeline(draft.name, {
        ...(draft.description ? { description: draft.description } : {}),
        targets: draft.targets,
        steps: draft.steps.filter((step) => step.run.trim()),
      });
      setEditing(draft.name);
      setMessage(`Saved "${draft.name}".`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** @param {string} name */
  async function remove(name) {
    if (!window.confirm(`Delete pipeline "${name}"?`)) return;
    try {
      await api.deletePipeline(name);
      if (editing === name) {
        setDraft(emptyDraft());
        setEditing('');
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const placeholders = [
    ...BUILTIN,
    ...params.map((p) => p.name),
    ...siteKeys.filter((key) => !params.some((p) => p.name === key)),
  ];
  const valid =
    /^[a-z0-9][a-z0-9_-]*$/.test(draft.name) &&
    draft.targets.length > 0 &&
    draft.steps.some((step) => step.run.trim() && step.name.trim());

  return (
    <section className="editor">
      <h2>{editing ? `Edit ${editing}` : 'New pipeline'}</h2>

      <div className="card">
        <div className="row">
          <strong>Templates</strong>
          {Object.entries(PIPELINES).map(([label, template]) => (
            <button
              type="button"
              key={label}
              className="chip"
              onClick={() =>
                update({
                  description: draft.description || template.description,
                  steps: stepsFrom(template.steps),
                })
              }
            >
              {label}
            </button>
          ))}
        </div>

        <label className="field">
          <span>Name</span>
          <input
            value={draft.name}
            disabled={Boolean(editing)}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="release-fr"
          />
        </label>
        <label className="field">
          <span>Description</span>
          <input
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
          />
        </label>
        <fieldset className="inline">
          <legend className="muted">Default targets</legend>
          {targets.map((target) => (
            <label key={target.name}>
              <input
                type="checkbox"
                checked={draft.targets.includes(target.name)}
                onChange={() =>
                  update({
                    targets: draft.targets.includes(target.name)
                      ? draft.targets.filter((t) => t !== target.name)
                      : [...draft.targets, target.name],
                  })
                }
              />{' '}
              {target.name}
              {target.environment && <span className="muted"> · {target.environment}</span>}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <span>Steps</span>
          <ol className="step-editor">
            {draft.steps.map((step, index) => (
              <li key={index}>
                <div className="row">
                  <input
                    value={step.name}
                    onChange={(e) => updateStep(index, { name: e.target.value })}
                    placeholder="Step name"
                  />
                  <label className="muted">
                    <input
                      type="checkbox"
                      checked={Boolean(step.continueOnError)}
                      onChange={(e) => updateStep(index, { continueOnError: e.target.checked })}
                    />{' '}
                    continue on error
                  </label>
                  <label className="muted">
                    timeout{' '}
                    <input
                      type="number"
                      min={1}
                      className="narrow"
                      value={step.timeoutSeconds ?? 600}
                      onChange={(e) =>
                        updateStep(index, { timeoutSeconds: Number(e.target.value) })
                      }
                    />
                    s
                  </label>
                  <span className="actions">
                    <button
                      type="button"
                      className="link"
                      disabled={!index}
                      onClick={() => moveStep(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="link"
                      disabled={index === draft.steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="link danger-text"
                      onClick={() => update({ steps: draft.steps.filter((_, i) => i !== index) })}
                    >
                      remove
                    </button>
                  </span>
                </div>
                <textarea
                  rows={2}
                  value={step.run}
                  spellCheck={false}
                  placeholder="vendor/bin/drush {alias} cr"
                  onFocus={(e) => (lastField.current = { index, el: e.currentTarget })}
                  onChange={(e) => updateStep(index, { run: e.target.value })}
                />
              </li>
            ))}
          </ol>
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => update({ steps: [...draft.steps, { name: '', run: '' }] })}
            >
              Add step
            </button>
            <span className="muted">or add</span>
            {Object.keys(STEPS).map((key) => (
              <button
                type="button"
                key={key}
                className="chip"
                onClick={() =>
                  update({
                    steps: [...draft.steps.filter((s) => s.run.trim()), ...stepsFrom([key])],
                  })
                }
              >
                {key}
              </button>
            ))}
          </div>
        </div>

        <div className="row">
          <span className="muted">Insert into the last command:</span>
          {placeholders.map((name) => (
            <button type="button" key={name} className="chip" onClick={() => insert(name)}>
              {`{${name}}`}
            </button>
          ))}
        </div>

        <div className="row">
          <button type="button" onClick={save} disabled={!valid}>
            Save pipeline
          </button>
          <button
            type="button"
            className="link"
            onClick={() => {
              setDraft(emptyDraft());
              setEditing('');
              setMessage('');
            }}
          >
            New
          </button>
          {message && <span className="ok-text">{message}</span>}
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      <h3>Pipelines</h3>
      <table className="history">
        <thead>
          <tr>
            <th>Name</th>
            <th>Steps</th>
            <th>Targets</th>
            <th>Source</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pipelines.map((pipeline) => (
            <tr key={pipeline.name} className="static">
              <td>
                <strong>{pipeline.name}</strong>
                {pipeline.description && <div className="muted">{pipeline.description}</div>}
              </td>
              <td>{pipeline.steps.length}</td>
              <td>{pipeline.targets.join(', ')}</td>
              <td className="muted">
                {pipeline.source === 'dashboard' ? 'dashboard' : 'config file'}
              </td>
              <td className="actions">
                {pipeline.source === 'dashboard' && (
                  <button className="link" onClick={() => open(pipeline, false)}>
                    edit
                  </button>
                )}
                <button className="link" onClick={() => open(pipeline, true)}>
                  duplicate
                </button>
                {pipeline.source === 'dashboard' && (
                  <button className="link danger-text" onClick={() => remove(pipeline.name)}>
                    delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
