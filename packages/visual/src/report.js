import { writeFile } from 'node:fs/promises';
import { relative } from 'node:path';

/** @import { PageDiff } from './compare.js' */

/** @param {string} text */
export function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

const ORDER = { changed: 0, added: 1, removed: 2, same: 3 };

/**
 * @typedef {object} ReportInput
 * @property {string} title
 * @property {string} beforeDir
 * @property {string} afterDir
 * @property {string} beforeLabel
 * @property {string} afterLabel
 * @property {PageDiff[]} results
 */

/**
 * Renders a self-contained HTML page with before / after / diff images side by
 * side. Image paths are relative to `reportFile`, so the folder can be zipped
 * and shared as is.
 *
 * @param {ReportInput} input
 * @param {string} reportFile
 */
export function renderReport(input, reportFile) {
  const base = reportFile.replace(/[^/\\]+$/, '');
  /** @param {string} file */
  const src = (file) => escapeHtml(relative(base, file).split('\\').join('/'));
  const changed = input.results.filter((r) => r.status !== 'same').length;

  const rows = [...input.results]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
    .map((r) => {
      const img = (/** @type {string} */ dir, /** @type {string} */ label) =>
        `<figure><figcaption>${escapeHtml(label)}</figcaption><a href="${src(`${dir}/${r.name}`)}"><img loading="lazy" src="${src(`${dir}/${r.name}`)}" alt=""></a></figure>`;
      const images = [
        r.status !== 'added' ? img(input.beforeDir, input.beforeLabel) : '',
        r.status !== 'removed' ? img(input.afterDir, input.afterLabel) : '',
        r.diffFile && r.status === 'changed'
          ? `<figure><figcaption>diff</figcaption><a href="${src(r.diffFile)}"><img loading="lazy" src="${src(r.diffFile)}" alt=""></a></figure>`
          : '',
      ].join('');
      const ratio = r.diffFile ? ` · ${(r.ratio * 100).toFixed(2)}%` : '';
      return `<details class="${r.status}"${r.status === 'same' ? '' : ' open'}>
<summary><span class="badge">${r.status}</span> ${escapeHtml(r.name)}<span class="muted">${ratio}</span></summary>
<div class="images">${images}</div>
</details>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)}</title>
<style>
:root { --bg: #fff; --fg: #1d1d1f; --muted: #6e6e73; --line: #e3e3e8; --bad: #c62828; --warn: #b26a00; --ok: #2e7d32; }
@media (prefers-color-scheme: dark) { :root { --bg: #161618; --fg: #ececf1; --muted: #9a9aa2; --line: #2c2c31; --bad: #ef6b6b; --warn: #e0a24a; --ok: #6cc070; } }
body { margin: 0; padding: 24px 16px; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--fg); }
h1 { font-size: 20px; margin: 0 0 4px; }
.muted { color: var(--muted); }
details { border-top: 1px solid var(--line); padding: 8px 0; }
summary { cursor: pointer; }
.badge { display: inline-block; min-width: 64px; font-size: 12px; font-weight: 600; text-transform: uppercase; }
.changed .badge { color: var(--bad); } .added .badge, .removed .badge { color: var(--warn); } .same .badge { color: var(--ok); }
.images { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; margin-top: 8px; }
figure { margin: 0; } figcaption { color: var(--muted); font-size: 12px; }
img { width: 100%; border: 1px solid var(--line); }
</style>
</head>
<body>
<h1>${escapeHtml(input.title)}</h1>
<p class="muted">${escapeHtml(input.beforeLabel)} → ${escapeHtml(input.afterLabel)} · ${changed} of ${input.results.length} pages differ · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}</p>
${rows}
</body>
</html>
`;
}

/**
 * @param {ReportInput} input
 * @param {string} reportFile
 */
export async function writeReport(input, reportFile) {
  await writeFile(reportFile, renderReport(input, reportFile));
  return reportFile;
}
