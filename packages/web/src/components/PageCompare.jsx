import { useCallback, useEffect, useState } from 'react';
import {
  AccessFields,
  CaptureSettings,
  DEFAULT_CAPTURE,
  NO_ACCESS,
  accessBody,
  captureBody,
  loadStored,
  urlLines,
} from './CaptureSettings.jsx';

/** @import { Api, PairInfo, PairsJobInfo } from '../api.js' */

const SETTINGS_KEY = 'dops-compare-settings';

/** @param {{ pair: PairInfo }} props */
function PairCard({ pair }) {
  const badge = { identical: 'ok', different: 'warn', error: 'failed' }[pair.status];
  return (
    <li className="card diff-card">
      <div className="row">
        <span className="muted">#{pair.index + 1}</span>
        <span className={`status ${badge}`}>{pair.status}</span>
        {pair.diffPercent !== undefined && (
          <span className="muted">{pair.diffPercent}% different</span>
        )}
        {pair.sizeMismatch && pair.sizeA && pair.sizeB && (
          <span className="warn-text">
            sizes differ: {pair.sizeA.width}×{pair.sizeA.height} vs {pair.sizeB.width}×
            {pair.sizeB.height}
          </span>
        )}
      </div>
      <div className="pair-urls">
        <a href={pair.urlA} target="_blank" rel="noreferrer">
          A: {pair.urlA}
        </a>
        <a href={pair.urlB} target="_blank" rel="noreferrer">
          B: {pair.urlB}
        </a>
      </div>
      {pair.message && <p className="error">{pair.message}</p>}
      {pair.imageA && pair.imageB && (
        <div className="shots">
          {[
            ['A', pair.imageA],
            ['B', pair.imageB],
            ['Difference', pair.diffImage],
          ].map(([label, src]) =>
            src ? (
              <figure key={label}>
                <figcaption>{label}</figcaption>
                <a href={src} target="_blank" rel="noreferrer" title="Open full size">
                  <img src={src} alt={`${label} #${pair.index + 1}`} loading="lazy" />
                </a>
              </figure>
            ) : null,
          )}
        </div>
      )}
    </li>
  );
}

/**
 * Two URL lists paired line by line (e.g. production and staging, or old and
 * new URLs after a migration), screenshotted and diffed pair by pair.
 *
 * @param {{ api: Api }} props
 */
export function PageCompare({ api }) {
  const [settings, setSettings] = useState(() =>
    loadStored(SETTINGS_KEY, { urlsA: '', urlsB: '', ...DEFAULT_CAPTURE }),
  );
  const [accessA, setAccessA] = useState(NO_ACCESS);
  const [accessB, setAccessB] = useState(NO_ACCESS);
  const [job, setJob] = useState(/** @type {PairsJobInfo | null} */ (null));
  const [result, setResult] = useState(
    /** @type {{ createdAt: string, results: PairInfo[] } | null} */ (null),
  );
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [error, setError] = useState('');

  /** @param {Partial<typeof settings>} patch */
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
    const state = await api.pairs();
    setJob(state.job);
    setResult(state.result);
  }, [api]);

  const running = job?.status === 'running';
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    if (!running) return undefined;
    const timer = setInterval(() => refresh().catch(() => {}), 1000);
    return () => clearInterval(timer);
  }, [refresh, running]);

  const listA = urlLines(settings.urlsA);
  const listB = urlLines(settings.urlsB);
  const paired = listA.length > 0 && listA.length === listB.length;

  async function start() {
    setError('');
    try {
      setJob(
        await api.startPairs({
          urlsA: listA,
          urlsB: listB,
          ...captureBody(settings),
          sideA: accessBody(accessA),
          sideB: accessBody(accessB),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function clear() {
    if (!window.confirm('Delete the page compare screenshots?')) return;
    try {
      await api.clearPairs();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const results = result?.results ?? [];
  const shown = onlyDifferent ? results.filter((r) => r.status !== 'identical') : results;
  const different = results.filter((r) => r.status === 'different').length;

  return (
    <section className="visual-testing">
      <h2>Page compare</h2>
      <div className="card">
        <div className="two-columns">
          <label className="field">
            <span>Source A URLs (one per line)</span>
            <textarea
              rows={6}
              spellCheck={false}
              value={settings.urlsA}
              onChange={(e) => update({ urlsA: e.target.value })}
              placeholder={'https://www.example.com/\nhttps://www.example.com/news'}
            />
            <span className="muted small">{listA.length} URL(s)</span>
          </label>
          <label className="field">
            <span>Source B URLs (same order)</span>
            <textarea
              rows={6}
              spellCheck={false}
              value={settings.urlsB}
              onChange={(e) => update({ urlsB: e.target.value })}
              placeholder={'https://staging.example.com/\nhttps://staging.example.com/news'}
            />
            <span className={`small ${listB.length !== listA.length ? 'error' : 'muted'}`}>
              {listB.length} URL(s)
              {listB.length !== listA.length && ' (both lists need the same number)'}
            </span>
          </label>
        </div>
        <CaptureSettings settings={settings} update={update} />
        <div className="two-columns">
          <AccessFields
            label="A: "
            access={accessA}
            update={(patch) => setAccessA({ ...accessA, ...patch })}
          />
          <AccessFields
            label="B: "
            access={accessB}
            update={(patch) => setAccessB({ ...accessB, ...patch })}
          />
        </div>
        <div className="row">
          <button disabled={running || !paired} onClick={start}>
            Compare {listA.length || ''} pair(s)
          </button>
          {running && (
            <button className="danger" onClick={() => api.cancelPairs().then(refresh)}>
              Stop
            </button>
          )}
          <button className="link danger-text" disabled={running} onClick={clear}>
            Clear
          </button>
        </div>
        {error && <p className="error">{error}</p>}
      </div>

      {job && (
        <div className="card progress-card">
          <div className="row">
            <strong>Screenshots</strong>
            <span className={`status ${job.status === 'done' ? 'ok' : job.status}`}>
              {job.status}
            </span>
            <span className="muted">
              {job.captured}/{job.total}
            </span>
          </div>
          <progress max={job.total} value={job.captured} />
          {job.error && <p className="error">{job.error}</p>}
          {job.errors.length > 0 && (
            <ul className="page-errors">
              {job.errors.map((item) => (
                <li key={`${item.side}${item.url}`}>
                  <span className="error">{item.side}</span> {item.url}
                  <span className="muted"> · {item.error}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {result && (
        <>
          <div className="summary-bar">
            <strong>
              {different} of {results.length} pairs differ
            </strong>
            <span className="muted small">{new Date(result.createdAt).toLocaleString()}</span>
            <label>
              <input
                type="checkbox"
                checked={onlyDifferent}
                onChange={(e) => setOnlyDifferent(e.target.checked)}
              />{' '}
              Hide identical
            </label>
          </div>
          <ul className="diff-list">
            {shown.map((pair) => (
              <PairCard key={pair.index} pair={pair} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
