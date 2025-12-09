import { useState } from 'react';
import { History } from './components/History.jsx';
import { Pipelines } from './components/Pipelines.jsx';
import { RunView } from './components/RunView.jsx';
import { TokenGate } from './components/TokenGate.jsx';

const TABS = /** @type {const} */ (['Pipelines', 'Local', 'History']);

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
