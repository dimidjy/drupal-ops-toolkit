const PRESETS = /** @type {const} */ ([
  ['Desktop', 1920, 1080],
  ['Laptop', 1440, 900],
  ['Tablet', 768, 1024],
  ['Mobile', 390, 844],
]);

/**
 * @typedef {object} CaptureSettingsValue
 * @property {number} width
 * @property {number} height
 * @property {number} settleMs
 * @property {number} concurrency
 * @property {boolean} fullPage
 * @property {boolean} blockTrackers
 */

/** @type {CaptureSettingsValue} */
export const DEFAULT_CAPTURE = {
  width: 1920,
  height: 1080,
  settleMs: 600,
  concurrency: 4,
  fullPage: true,
  blockTrackers: true,
};

/**
 * @param {string} key localStorage key
 * @param {object} defaults
 */
export function loadStored(key, defaults) {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(key) ?? '{}') };
  } catch {
    return defaults;
  }
}

/** @param {string} text */
export function urlLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/** @param {CaptureSettingsValue} settings */
export function captureBody(settings) {
  return {
    viewport: { width: settings.width, height: settings.height },
    fullPage: settings.fullPage,
    settleMs: settings.settleMs,
    concurrency: settings.concurrency,
    blockTrackers: settings.blockTrackers,
  };
}

/**
 * Viewport, parallel pages, settle delay, full page and tracker blocking.
 *
 * @param {{ settings: CaptureSettingsValue, update: (patch: Partial<CaptureSettingsValue>) => void }} props
 */
export function CaptureSettings({ settings, update }) {
  /**
   * @param {keyof CaptureSettingsValue} key
   * @param {string} label
   * @param {{ min?: number, max?: number, step?: number }} [limits]
   */
  const number = (key, label, limits = {}) => (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        className="narrow"
        {...limits}
        value={Number(settings[key])}
        onChange={(e) => update({ [key]: Number(e.target.value) })}
      />
    </label>
  );
  return (
    <>
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
        {number('width', 'Width')}
        {number('height', 'Height')}
        {number('concurrency', 'Parallel pages', { min: 1, max: 16 })}
        {number('settleMs', 'Settle delay (ms)', { min: 0, step: 100 })}
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
      </div>
    </>
  );
}

/**
 * @typedef {object} AccessValue
 * @property {boolean} authEnabled
 * @property {string} username
 * @property {string} password
 * @property {boolean} cookiesEnabled
 * @property {string} cookies JSON text
 */

/** @type {AccessValue} */
export const NO_ACCESS = {
  authEnabled: false,
  username: '',
  password: '',
  cookiesEnabled: false,
  cookies: '',
};

/**
 * Turns the access inputs into the request fields; throws on invalid cookie JSON.
 *
 * @param {AccessValue} access
 */
export function accessBody(access) {
  /** @type {{ auth?: { username: string, password: string }, cookies?: object[] }} */
  const body = {};
  if (access.authEnabled && access.username) {
    body.auth = { username: access.username, password: access.password };
  }
  if (access.cookiesEnabled && access.cookies.trim()) {
    const cookies = JSON.parse(access.cookies);
    if (!Array.isArray(cookies)) throw new Error('Cookies must be a JSON array');
    body.cookies = cookies;
  }
  return body;
}

/**
 * Basic auth and cookies for one site; never stored.
 *
 * @param {{ access: AccessValue, update: (patch: Partial<AccessValue>) => void, label?: string }} props
 */
export function AccessFields({ access, update, label = '' }) {
  return (
    <div className="access">
      <div className="row">
        <label>
          <input
            type="checkbox"
            checked={access.authEnabled}
            onChange={(e) => update({ authEnabled: e.target.checked })}
          />{' '}
          {label}HTTP basic auth
        </label>
        <label>
          <input
            type="checkbox"
            checked={access.cookiesEnabled}
            onChange={(e) => update({ cookiesEnabled: e.target.checked })}
          />{' '}
          {label}Cookies
        </label>
      </div>
      {access.authEnabled && (
        <div className="row">
          <label className="field">
            <span>Username</span>
            <input
              value={access.username}
              autoComplete="off"
              onChange={(e) => update({ username: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={access.password}
              autoComplete="off"
              onChange={(e) => update({ password: e.target.value })}
            />
          </label>
          <span className="muted small">Only sent for this run, never stored.</span>
        </div>
      )}
      {access.cookiesEnabled && (
        <label className="field">
          <span>Cookies (JSON array)</span>
          <textarea
            rows={3}
            value={access.cookies}
            spellCheck={false}
            onChange={(e) => update({ cookies: e.target.value })}
            placeholder={'[{ "name": "SESSabc", "value": "…" }]'}
          />
        </label>
      )}
    </div>
  );
}
