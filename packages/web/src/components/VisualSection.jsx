import { useState } from 'react';
import { PageCompare } from './PageCompare.jsx';
import { Visual } from './Visual.jsx';
import { VisualTesting } from './VisualTesting.jsx';

/** @import { Api } from '../api.js' */

const MODES = /** @type {const} */ ([
  ['before-after', 'Before / after'],
  ['a-b', 'A vs B'],
  ['reports', 'Reports'],
]);

/** @typedef {(typeof MODES)[number][0]} Mode */

const MODE_KEY = 'dops-visual-mode';

/** @returns {Mode} */
function savedMode() {
  try {
    const value = localStorage.getItem(MODE_KEY);
    return MODES.some(([key]) => key === value) ? /** @type {Mode} */ (value) : 'before-after';
  } catch {
    return 'before-after';
  }
}

/**
 * One tab for every screenshot comparison, with a switch between the same
 * pages before and after a change, two lists side by side, and CLI reports.
 *
 * @param {{ api: Api }} props
 */
export function VisualSection({ api }) {
  const [mode, setMode] = useState(savedMode);

  /** @param {Mode} next */
  function choose(next) {
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      return;
    }
  }

  return (
    <section>
      <div className="section-head">
        <h2>Visual</h2>
        <div className="segmented" role="tablist" aria-label="Comparison mode">
          {MODES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={mode === key}
              className={mode === key ? 'active' : ''}
              onClick={() => choose(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {mode === 'before-after' && <VisualTesting api={api} />}
      {mode === 'a-b' && <PageCompare api={api} />}
      {mode === 'reports' && <Visual api={api} />}
    </section>
  );
}
