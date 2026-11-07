import { useState } from 'react';
import { Board } from './components/Board.jsx';
import { History } from './components/History.jsx';
import { Jira } from './components/Jira.jsx';
import { PageCompare } from './components/PageCompare.jsx';
import { Pipelines } from './components/Pipelines.jsx';
import { Review } from './components/Review.jsx';
import { RunView } from './components/RunView.jsx';
import { Tests } from './components/Tests.jsx';
import { TokenGate } from './components/TokenGate.jsx';
import { Visual } from './components/Visual.jsx';
import { VisualTesting } from './components/VisualTesting.jsx';

const GROUPS = /** @type {const} */ ([
  [
    'Deploy',
    [
      ['deploy', 'Pipelines'],
      ['runs', 'Runs'],
    ],
  ],
  [
    'QA',
    [
      ['tests', 'UI tests'],
      ['visual', 'Visual testing'],
      ['compare', 'Page compare'],
      ['reports', 'Reports'],
    ],
  ],
  [
    'AI & Jira',
    [
      ['review', 'Review'],
      ['jira', 'Jira'],
      ['board', 'Board'],
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
    deploy: () => <Pipelines api={api} onStarted={setRunId} />,
    runs: () => <History api={api} onOpen={setRunId} />,
    tests: () => <Tests api={api} />,
    visual: () => <VisualTesting api={api} />,
    compare: () => <PageCompare api={api} />,
    reports: () => <Visual api={api} />,
    review: () => <Review api={api} />,
    jira: () => <Jira api={api} />,
    board: () => <Board api={api} />,
  };

  return (
    <div className="layout">
      <aside>
        <strong className="brand">dops</strong>
        <nav>
          {GROUPS.map(([group, items]) => (
            <div key={group} className="nav-items">
              <span className="nav-group">{group}</span>
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
