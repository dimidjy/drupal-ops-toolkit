import { useState } from 'react';
import { RunView } from './components/RunView.jsx';
import {
  DeploySection,
  JiraSection,
  ReviewSection,
  TestsSection,
  VisualSection,
} from './components/Sections.jsx';
import { TokenGate } from './components/TokenGate.jsx';

const GROUPS = /** @type {const} */ ([
  ['Deploy', [['deploy', 'Deploy']]],
  [
    'QA',
    [
      ['tests', 'UI tests'],
      ['visual', 'Visual'],
    ],
  ],
  [
    'AI & Jira',
    [
      ['review', 'Review'],
      ['jira', 'Jira'],
    ],
  ],
]);

/** @typedef {(typeof GROUPS)[number][1][number][0]} Section */

/**
 * @param {{ api: import('./api.js').Api, logout: () => void }} props
 */
function Dashboard({ api, logout }) {
  const [section, setSection] = useState(/** @type {Section} */ ('deploy'));
  const [runId, setRunId] = useState('');

  /** @type {Record<Section, () => import('react').ReactNode>} */
  const views = {
    deploy: () => <DeploySection api={api} onOpenRun={setRunId} />,
    tests: () => <TestsSection api={api} />,
    visual: () => <VisualSection api={api} />,
    review: () => <ReviewSection api={api} />,
    jira: () => <JiraSection api={api} />,
  };

  return (
    <div className="layout">
      <aside>
        <strong className="brand">dops</strong>
        <nav>
          {GROUPS.map(([group, items]) => (
            <div key={group} className="nav-items">
              {items.length > 1 && <span className="nav-group">{group}</span>}
              {items.map(([key, label]) => (
                <button
                  key={key}
                  className={`tab ${section === key && !runId ? 'active' : ''}`}
                  onClick={() => {
                    setSection(key);
                    setRunId('');
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button className="link logout" onClick={logout}>
          Log out
        </button>
      </aside>
      <main>
        {runId ? (
          <RunView api={api} runId={runId} onClose={() => setRunId('')} />
        ) : (
          views[section]()
        )}
      </main>
    </div>
  );
}

export function App() {
  return <TokenGate>{(api, logout) => <Dashboard api={api} logout={logout} />}</TokenGate>;
}
