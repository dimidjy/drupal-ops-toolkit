import { useCallback, useEffect, useState } from 'react';

/** @import { Api, CaptureJobInfo, CompareInfo, VisualDiffInfo } from '../api.js' */

const SETTINGS_KEY = 'dops-visual-settings';
const PAGE = 20;
const PRESETS = /** @type {const} */ ([
  ['Desktop', 1920, 1080],
  ['Laptop', 1440, 900],
  ['Tablet', 768, 1024],
  ['Mobile', 390, 844],
]);

/**
 * @typedef {object} Settings
 * @property {string} urls
 * @property {number} width
 * @property {number} height
 * @property {number} settleMs
 * @property {boolean} fullPage
 * @property {boolean} blockTrackers
 */

/** @type {Settings} */
const DEFAULTS = {
  urls: '',
  width: 1920,
  height: 1080,
  settleMs: 600,
  fullPage: true,
  blockTrackers: true,
};

/** @returns {Settings} */
function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

/** @param {string} text */
function urlLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** @param {string} [iso] */
const time = (iso) => (iso ? new Date(iso).toLocaleString() : '');

/** @param {{ result: VisualDiffInfo }} props */
function DiffCard({ result }) {
  return (
    <li className="card diff-card">
      <div className="row">
        <a href={result.url} target="_blank" rel="noreferrer" className="url">
          {result.url}
        </a>
        <span className={`status ${result.status === 'error' ? 'failed' : 'warn'}`}>
          {result.status}
        </span>
        {result.diffPercent !== undefined && (
          <span className="muted">{result.diffPercent}% different</span>
        )}
        {result.sizeMismatch && result.dimensionDifference && (
          <span className="warn-text">
            size changed: {result.dimensionDifference.width}px × {result.dimensionDifference.height}
            px
          </span>
        )}
      </div>
      {result.message && <p className="error">{result.message}</p>}
      {result.diffImage && (
        <div className="shots">
          {[
            ['Before', result.beforeImage, time(result.beforeCapturedAt)],
            ['After', result.afterImage, time(result.afterCapturedAt)],
            ['Difference', result.diffImage, 'changed pixels in red'],
          ].map(([label, src, note]) => (
            <figure key={label}>
              <figcaption>{label}</figcaption>
              <a href={src} target="_blank" rel="noreferrer" title="Open full size">
                <img src={src} alt={`${label}: ${result.url}`} loading="lazy" />
              </a>
              <span className="muted small">{note}</span>
            </figure>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Paste URLs, screenshot them before and after a change, and page through the
 * pages that changed.
 *
 * @param {{ api: Api }} props
 */
export function VisualTesting({ api }) {
  const [settings, setSettings] = useState(loadSettings);
  const [auth, setAuth] = useState({ enabled: false, username: '', password: '' });
  const [cookies, setCookies] = useState({ enabled: false, json: '' });
  const [job, setJob] = useState(/** @type {CaptureJobInfo | null} */ (null));
  const [counts, setCounts] = useState({ before: 0, after: 0 });
  const [compare, setCompare] = useState(
    /** @type {(CompareInfo & { loading: boolean }) | null} */ (null),
  );
  const [error, setError] = useState('');

  /** @param {Partial<Settings>} patch */
  function update(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    } catch {
      // Settings are a convenience only.
    }
  }

  const refresh = useCallback(async () => {
    const state = await api.visualWorkspace();
    setJob(state.job);
    setCounts(state.counts);
  }, [api]);

  const running = job?.status === 'running';
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    if (!running) return undefined;
    const timer = setInterval(() => refresh().catch(() => {}), 1000);
    return () => clearInterval(timer);
  }, [refresh, running]);

  /** @param {'before' | 'after'} phase */
  async function capture(phase) {
    setError('');
    try {
      let cookieList;
      if (cookies.enabled && cookies.json.trim()) {
        cookieList = JSON.parse(cookies.json);
        if (!Array.isArray(cookieList)) throw new Error('Cookies must be a JSON array');
      }
      setJob(
        await api.visualCapture({
          phase,
          urls: urlLines(settings.urls),
          viewport: { width: settings.width, height: settings.height },
          fullPage: settings.fullPage,
          settleMs: settings.settleMs,
          blockTrackers: settings.blockTrackers,
          ...(auth.enabled && auth.username
            ? { auth: { username: auth.username, password: auth.password } }
            : {}),
          ...(cookieList ? { cookies: cookieList } : {}),
        }),
      );
      if (phase === 'before') setCompare(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** @param {boolean} reset */
  async function runCompare(reset) {
    const start = reset || !compare ? 0 : compare.nextStart;
    setCompare((current) =>
      reset || !current
        ? {
            nextStart: 0,
            total: 0,
            identicalSkipped: 0,
            done: false,
            onlyBefore: 0,
            onlyAfter: 0,
            results: [],
            loading: true,
          }
        : { ...current, loading: true },
    );
    try {
      const page = await api.visualCompare(start, PAGE);
      setCompare((current) => ({
        ...page,
        results: [...(reset || !current ? [] : current.results), ...page.results],
        identicalSkipped:
          (reset || !current ? 0 : current.identicalSkipped) + page.identicalSkipped,
        loading: false,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setCompare((current) => (current ? { ...current, loading: false } : null));
    }
  }

  async function clear() {
    if (!window.confirm('Delete all before/after screenshots?')) return;
    try {
      await api.visualClear();
      setCompare(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const urls = urlLines(settings.urls);
  const done = job?.pages.length ?? 0;
  const failed = job?.pages.filter((p) => p.error || p.status >= 400) ?? [];

  return (
    <section className="visual-testing">
      <h2>Visual testing</h2>
      <div className="card">
        <label className="field">
          <span>Site URLs (one per line)</span>
          <textarea
            rows={6}
            value={settings.urls}
            onChange={(e) => update({ urls: e.target.value })}
            placeholder={'https://staging.example.com/\nhttps://staging.example.com/products'}
            spellCheck={false}
          />
          <span className="muted small">{urls.length} URL(s)</span>
        </label>

        <div className="row">
          <label className="field">
            <span>Viewport</span>
            <select
              value={`${settings.width}x${settings.height}`}
              onChange={(e) => {
                const [width, height] = e.target.value.split('x').map(Number);
                if (width && height) update({ width, height });
              }}
            >
              {PRESETS.map(([label, w, h]) => (
                <option key={label} value={`${w}x${h}`}>
                  {label} {w}×{h}
                </option>
              ))}
              {!PRESETS.some(([, w, h]) => w === settings.width && h === settings.height) && (
                <option value={`${settings.width}x${settings.height}`}>Custom</option>
              )}
            </select>
          </label>
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              className="narrow"
              value={settings.width}
              onChange={(e) => update({ width: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Height</span>
            <input
              type="number"
              className="narrow"
              value={settings.height}
              onChange={(e) => update({ height: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Settle delay (ms)</span>
            <input
              type="number"
              className="narrow"
              min={0}
              step={100}
              value={settings.settleMs}
              onChange={(e) => update({ settleMs: Number(e.target.value) })}
            />
          </label>
        </div>

        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={settings.fullPage}
              onChange={(e) => update({ fullPage: e.target.checked })}
            />{' '}
            Full page
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.blockTrackers}
              onChange={(e) => update({ blockTrackers: e.target.checked })}
            />{' '}
            Block analytics and cookie-banner scripts
          </label>
          <label>
            <input
              type="checkbox"
              checked={auth.enabled}
              onChange={(e) => setAuth({ ...auth, enabled: e.target.checked })}
            />{' '}
            HTTP basic auth
          </label>
          <label>
            <input
              type="checkbox"
              checked={cookies.enabled}
              onChange={(e) => setCookies({ ...cookies, enabled: e.target.checked })}
            />{' '}
            Cookies
          </label>
        </div>

        {auth.enabled && (
          <div className="row">
            <label className="field">
              <span>Username</span>
              <input
                value={auth.username}
                autoComplete="off"
                onChange={(e) => setAuth({ ...auth, username: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={auth.password}
                autoComplete="off"
                onChange={(e) => setAuth({ ...auth, password: e.target.value })}
              />
            </label>
            <span className="muted small">Only sent for this capture, never stored.</span>
          </div>
        )}
        {cookies.enabled && (
          <label className="field">
            <span>Cookies (JSON array)</span>
            <textarea
              rows={3}
              value={cookies.json}
              spellCheck={false}
              onChange={(e) => setCookies({ ...cookies, json: e.target.value })}
              placeholder={'[{ "name": "SESSabc", "value": "…" }]'}
            />
          </label>
        )}

        <div className="row">
          <button disabled={running || !urls.length} onClick={() => capture('before')}>
            Take “before” screenshots
          </button>
          <button disabled={running || !urls.length} onClick={() => capture('after')}>
            Take “after” screenshots
          </button>
          <button
            className="secondary"
            disabled={running || !counts.before || !counts.after || compare?.loading}
            onClick={() => runCompare(true)}
          >
            Compare
          </button>
          {running && (
            <button className="danger" onClick={() => api.visualCancel().then(refresh)}>
              Stop
            </button>
          )}
          <button className="link danger-text" disabled={running} onClick={clear}>
            Clear screenshots
          </button>
          <span className="muted">
            before: {counts.before} · after: {counts.after}
          </span>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {job && (
        <div className="card progress-card">
          <div className="row">
            <strong>“{job.phase}” screenshots</strong>
            <span className={`status ${job.status === 'done' ? 'ok' : job.status}`}>
              {job.status}
            </span>
            <span className="muted">
              {done}/{job.total}
              {job.finishedAt && ` · ${time(job.finishedAt)}`}
            </span>
          </div>
          <progress max={job.total} value={done} />
          {job.error && <p className="error">{job.error}</p>}
          {failed.length > 0 && (
            <ul className="page-errors">
              {failed.map((page) => (
                <li key={page.url}>
                  <span className="error">{page.error ? 'error' : page.status}</span> {page.url}
                  {page.error && <span className="muted"> · {page.error}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {compare && (
        <>
          <div className="summary-bar">
            <strong>{compare.results.length} difference(s)</strong>
            <span className="muted">{compare.identicalSkipped} identical skipped</span>
            <span className="muted">
              scanned {compare.nextStart}/{compare.total}
            </span>
            {(compare.onlyBefore > 0 || compare.onlyAfter > 0) && (
              <span className="muted">
                {compare.onlyBefore} only before · {compare.onlyAfter} only after
              </span>
            )}
          </div>
          {compare.done && !compare.results.length && !compare.loading && (
            <p className="ok-text">No differences: every compared page looks the same.</p>
          )}
          <ul className="diff-list">
            {compare.results.map((result) => (
              <DiffCard key={result.url} result={result} />
            ))}
          </ul>
          {!compare.done && (
            <button
              className="secondary"
              disabled={compare.loading}
              onClick={() => runCompare(false)}
            >
              {compare.loading ? 'Comparing…' : 'Load more differences'}
            </button>
          )}
        </>
      )}
    </section>
  );
}
