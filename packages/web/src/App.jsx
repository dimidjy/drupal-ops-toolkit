import { useState } from 'react';
import { Pipelines } from './components/Pipelines.jsx';
import { RunView } from './components/RunView.jsx';
import { TokenGate } from './components/TokenGate.jsx';

/**
 * @param {{ api: import('./api.js').Api, logout: () => void }} props
 */
function Dashboard({ api, logout }) {
  const [runId, setRunId] = useState('');

  return (
    <div className="layout">
      <header>
        <strong>dops</strong>
        <span className="muted">deploy · check · review</span>
        <button className="link" onClick={logout}>
          Log out
        </button>
      </header>
      <main>
        {runId ? (
          <RunView api={api} runId={runId} onClose={() => setRunId('')} />
        ) : (
          <Pipelines api={api} onStarted={setRunId} />
        )}
      </main>
    </div>
  );
}

export function App() {
  return <TokenGate>{(api, logout) => <Dashboard api={api} logout={logout} />}</TokenGate>;
}
