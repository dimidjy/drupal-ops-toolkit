import { useState } from 'react';
import { Board } from './components/Board.jsx';
import { History } from './components/History.jsx';
import { Jira } from './components/Jira.jsx';
import { Params } from './components/Params.jsx';
import { PipelineEditor } from './components/PipelineEditor.jsx';
import { Pipelines } from './components/Pipelines.jsx';
import { Review } from './components/Review.jsx';
import { RunView } from './components/RunView.jsx';
import { TokenGate } from './components/TokenGate.jsx';
import { VisualTesting } from './components/VisualTesting.jsx';

const TABS = /** @type {const} */ ([
  'Pipelines',
  'Local',
  'Editor',
  'Parameters',
  'Visual',
  'Review',
  'Jira',
  'Board',
  'History',
]);

/**
 * @param {{ api: import('./api.js').Api, logout: () => void }} props
 */
function Dashboard({ api, logout }) {
  const [tab, setTab] = useState(/** @type {(typeof TABS)[number]} */ ('Pipelines'));
  const [runId, setRunId] = useState('');

  return (
    <div className="layout">
      <header>
        <strong>dops</strong>
        <nav>
          {TABS.map((name) => (
            <button
              key={name}
              className={`tab ${tab === name && !runId ? 'active' : ''}`}
              onClick={() => {
                setTab(name);
                setRunId('');
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        <button className="link" onClick={logout}>
          Log out
        </button>
      </header>
      <main>
        {runId ? (
          <RunView api={api} runId={runId} onClose={() => setRunId('')} />
        ) : tab === 'Pipelines' ? (
          <Pipelines api={api} onStarted={setRunId} />
        ) : tab === 'Local' ? (
          <Pipelines key="local" api={api} onStarted={setRunId} scope="local" />
        ) : tab === 'Editor' ? (
          <PipelineEditor api={api} />
        ) : tab === 'Parameters' ? (
          <Params api={api} />
        ) : tab === 'Visual' ? (
          <VisualTesting api={api} />
        ) : tab === 'Review' ? (
          <Review api={api} />
        ) : tab === 'Jira' ? (
          <Jira api={api} />
        ) : tab === 'Board' ? (
          <Board api={api} />
        ) : (
          <History api={api} onOpen={setRunId} />
        )}
      </main>
    </div>
  );
}

export function App() {
  return <TokenGate>{(api, logout) => <Dashboard api={api} logout={logout} />}</TokenGate>;
}
