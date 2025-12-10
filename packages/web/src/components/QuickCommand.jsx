import { useState } from 'react';
import { ParamFields, placeholdersIn, splitParams, useParamValues } from './ParamFields.jsx';

/**
 * @import { Api, TargetInfo } from '../api.js'
 * @import { ParamContext } from './ParamFields.jsx'
 */

const RECENT_KEY = 'dops-recent-commands';

/** @returns {string[]} */
function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** @param {string[]} commands */
function saveRecent(commands) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(commands));
  } catch {
    // Private mode: recent commands are only a convenience.
  }
}

/**
 * Runs one shell command on the chosen targets, with live output in the run view.
 *
 * @param {{ api: Api, targets: TargetInfo[], sites: string[], paramContext: ParamContext,
 *   title: string, placeholder: string, onStarted: (runId: string) => void }} props
 */
export function QuickCommand({ api, targets, sites, paramContext, title, placeholder, onStarted }) {
  const [command, setCommand] = useState('');
  const [selected, setSelected] = useState(/** @type {string[]} */ ([]));
  const [site, setSite] = useState('');
  const [recent, setRecent] = useState(loadRecent);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = selected.filter((name) => targets.some((t) => t.name === name));
  const effective = chosen.length || targets.length !== 1 ? chosen : targets.map((t) => t.name);
  const values = useParamValues(paramContext);
  const { needsSite, fields } = splitParams(placeholdersIn(command), site, paramContext);
  const incomplete = fields.some((name) => !values.valueOf(name).trim()) || (needsSite && !site);

  /** @param {string} name */
  const toggle = (name) =>
    setSelected((current) =>
      current.includes(name) ? current.filter((t) => t !== name) : [...current, name],
    );

  /** @param {import('react').FormEvent} event */
  async function run(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { id } = await api.runCommand({
        command,
        targets: effective,
        ...(site ? { site } : {}),
        ...(fields.length ? { params: values.collect(fields) } : {}),
      });
      const next = [command, ...recent.filter((c) => c !== command)].slice(0, 15);
      setRecent(next);
      saveRecent(next);
      onStarted(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card quick-command" onSubmit={run}>
      <strong>{title}</strong>
      <textarea
        rows={2}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
        }}
        placeholder={placeholder}
        spellCheck={false}
      />
      {recent.length > 0 && (
        <div className="recent">
          {recent.slice(0, 6).map((item) => (
            <button type="button" key={item} className="chip" onClick={() => setCommand(item)}>
              {item}
            </button>
          ))}
        </div>
      )}
      {targets.length > 1 && (
        <fieldset className="inline">
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
      )}
      <ParamFields names={fields} context={paramContext} values={values} />
      <div className="row">
        {sites.length > 0 && (
          <select value={site} onChange={(e) => setSite(e.target.value)}>
            <option value="">No site</option>
            {sites.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <button type="submit" disabled={busy || !command.trim() || !effective.length || incomplete}>
          {busy ? 'Starting…' : 'Run'}
        </button>
        <span className="muted hint">Ctrl+Enter</span>
      </div>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
