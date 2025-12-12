import { useCallback, useEffect, useState } from 'react';

/** @import { Api, ParamInfo } from '../api.js' */

/**
 * Parameters steps can use as {name}: the ones from the config file plus the
 * ones managed here. Missing values are asked for when a pipeline runs.
 *
 * @param {{ api: Api }} props
 */
export function Params({ api }) {
  const [params, setParams] = useState(/** @type {ParamInfo[]} */ ([]));
  const [draft, setDraft] = useState({ name: '', description: '', default: '' });
  const [editing, setEditing] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => api.params().then(setParams), [api]);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  function reset() {
    setDraft({ name: '', description: '', default: '' });
    setEditing('');
  }

  /** @param {import('react').FormEvent} event */
  async function save(event) {
    event.preventDefault();
    setError('');
    try {
      await api.saveParam(draft.name, {
        ...(draft.description ? { description: draft.description } : {}),
        ...(draft.default ? { default: draft.default } : {}),
      });
      reset();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** @param {string} name */
  async function remove(name) {
    if (!window.confirm(`Delete parameter "${name}"?`)) return;
    try {
      await api.deleteParam(name);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <section>
      <h2>Parameters</h2>
      <form className="card" onSubmit={save}>
        <strong>{editing ? `Edit {${editing}}` : 'New parameter'}</strong>
        <div className="row">
          <label className="field">
            <span>Name</span>
            <input
              value={draft.name}
              disabled={Boolean(editing)}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="branch"
            />
          </label>
          <label className="field grow">
            <span>Description</span>
            <input
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Git branch to deploy"
            />
          </label>
          <label className="field">
            <span>Default</span>
            <input
              value={draft.default}
              onChange={(e) => setDraft({ ...draft, default: e.target.value })}
              placeholder="main"
            />
          </label>
        </div>
        <div className="row">
          <button type="submit" disabled={!/^[a-zA-Z_]\w*$/.test(draft.name)}>
            Save
          </button>
          {editing && (
            <button type="button" className="link" onClick={reset}>
              Cancel
            </button>
          )}
        </div>
        {error && <p className="error">{error}</p>}
      </form>

      <table className="history">
        <thead>
          <tr>
            <th>Placeholder</th>
            <th>Description</th>
            <th>Default</th>
            <th>Source</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {params.map((param) => (
            <tr key={param.name} className="static">
              <td>
                <code>{`{${param.name}}`}</code>
              </td>
              <td>{param.description}</td>
              <td>
                <code>{param.default}</code>
              </td>
              <td className="muted">
                {param.source === 'dashboard' ? 'dashboard' : 'config file'}
              </td>
              <td className="actions">
                {param.source === 'dashboard' && (
                  <>
                    <button
                      className="link"
                      onClick={() => {
                        setDraft({
                          name: param.name,
                          description: param.description ?? '',
                          default: param.default ?? '',
                        });
                        setEditing(param.name);
                      }}
                    >
                      edit
                    </button>
                    <button className="link danger-text" onClick={() => remove(param.name)}>
                      delete
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
