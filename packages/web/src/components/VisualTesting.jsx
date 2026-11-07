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

/** @import { Api, CaptureJobInfo, CompareInfo, VisualDiffInfo } from '../api.js' */

const SETTINGS_KEY = 'dops-visual-settings';
const PAGE = 20;

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
  const [settings, setSettings] = useState(() =>
    loadStored(SETTINGS_KEY, { urls: '', ...DEFAULT_CAPTURE }),
  );
  const [access, setAccess] = useState(NO_ACCESS);
  const [job, setJob] = useState(/** @type {CaptureJobInfo | null} */ (null));
  const [counts, setCounts] = useState({ before: 0, after: 0 });
  const [compare, setCompare] = useState(
    /** @type {(CompareInfo & { loading: boolean }) | null} */ (null),
  );
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
      setJob(
        await api.visualCapture({
          phase,
          urls: urlLines(settings.urls),
          ...captureBody(settings),
          ...accessBody(access),
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
            broken: [],
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
      <p className="muted mode-help">
        The same pages twice: capture &quot;before&quot;, make the change or deploy, capture
        &quot;after&quot;, then page through what moved.
      </p>
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

        <CaptureSettings settings={settings} update={update} />
        <AccessFields access={access} update={(patch) => setAccess({ ...access, ...patch })} />

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
          {compare.broken.length > 0 && (
            <div className="error">
              <strong>
                {compare.broken.length} page(s) did not load correctly in &quot;after&quot;, so they
                cannot pass:
              </strong>
              <ul className="page-errors">
                {compare.broken.map((page) => (
                  <li key={page.url}>
                    {page.url} · {page.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {compare.done &&
            !compare.results.length &&
            !compare.broken.length &&
            !compare.loading && (
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
