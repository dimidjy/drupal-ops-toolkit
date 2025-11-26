import { useEffect, useState } from 'react';
import { TokenGate } from './components/TokenGate.jsx';

/**
 * @param {{ api: import('./api.js').Api, logout: () => void }} props
 */
function Dashboard({ api, logout }) {
  const [pipelines, setPipelines] = useState(/** @type {import('./api.js').PipelineInfo[]} */ ([]));
  const [error, setError] = useState('');

  useEffect(() => {
    api.pipelines().then(setPipelines, (e) => setError(e.message));
  }, [api]);

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
        {error && <p className="error">{error}</p>}
        <h2>Pipelines</h2>
        <ul className="cards">
          {pipelines.map((p) => (
            <li key={p.name} className="card">
              <strong>{p.name}</strong>
              <span className="muted">{p.description}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

export function App() {
  return <TokenGate>{(api, logout) => <Dashboard api={api} logout={logout} />}</TokenGate>;
}
