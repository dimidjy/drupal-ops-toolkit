import { useState } from 'react';
import { Pipelines } from './components/Pipelines.jsx';
import { TokenGate } from './components/TokenGate.jsx';

/**
 * @param {{ api: import('./api.js').Api, logout: () => void }} props
 */
function Dashboard({ api, logout }) {
  const [lastRun, setLastRun] = useState('');

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
        {lastRun && (
          <p className="notice">
            Run started: <code>{lastRun}</code>
          </p>
        )}
        <Pipelines api={api} onStarted={setLastRun} />
      </main>
    </div>
  );
}

export function App() {
  return <TokenGate>{(api, logout) => <Dashboard api={api} logout={logout} />}</TokenGate>;
}
