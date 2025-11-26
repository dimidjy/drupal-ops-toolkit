import { useMemo, useState } from 'react';
import { createApi } from '../api.js';

const STORAGE_KEY = 'dops-token';

/** @returns {string} */
function storedToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * Asks for the API token once and remembers it in this browser.
 *
 * @param {{ children: (api: import('../api.js').Api, logout: () => void) => import('react').ReactNode }} props
 */
export function TokenGate({ children }) {
  const [token, setToken] = useState(storedToken);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const api = useMemo(() => (token ? createApi(token) : null), [token]);

  /** @param {import('react').FormEvent} event */
  async function submit(event) {
    event.preventDefault();
    try {
      await createApi(draft).pipelines();
      try {
        localStorage.setItem(STORAGE_KEY, draft);
      } catch {
        // Private mode: keep the token for this tab only.
      }
      setToken(draft);
      setError('');
    } catch {
      setError('Token rejected by the API.');
    }
  }

  function logout() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore
    }
    setToken('');
  }

  if (api) return children(api, logout);

  return (
    <form className="token-gate" onSubmit={submit}>
      <h1>dops</h1>
      <p>
        Paste the token printed by <code>dops serve</code> (or your DOPS_TOKEN).
      </p>
      <input
        type="password"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="API token"
        autoFocus
      />
      <button type="submit" disabled={!draft}>
        Connect
      </button>
      {error && <p className="error">{error}</p>}
    </form>
  );
}
