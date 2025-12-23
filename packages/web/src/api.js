/**
 * @typedef {object} PipelineInfo
 * @property {string} name
 * @property {string | null} description
 * @property {string[]} targets
 * @property {StepInfo[]} steps
 * @property {string[]} params Placeholders the steps need besides target, environment and path.
 * @property {'config' | 'dashboard'} source Dashboard pipelines can be edited here.
 */

/**
 * @typedef {object} StepInfo
 * @property {string} name
 * @property {string} run
 * @property {boolean} [continueOnError]
 * @property {number} [timeoutSeconds]
 */

/**
 * @typedef {object} ParamInfo
 * @property {string} name
 * @property {string | null} description
 * @property {string | null} default
 * @property {'config' | 'dashboard'} [source]
 */

/**
 * @typedef {object} TargetInfo
 * @property {string} name
 * @property {string | null} environment
 * @property {string} host
 */

/**
 * @typedef {object} CaptureJobInfo
 * @property {'before' | 'after'} phase
 * @property {'running' | 'done' | 'failed' | 'cancelled'} status
 * @property {number} total
 * @property {{ url: string, status: number, error?: string }[]} pages
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {string} [error]
 */

/**
 * @typedef {object} VisualDiffInfo
 * @property {string} url
 * @property {'different' | 'error'} status
 * @property {number} [diffPercent]
 * @property {boolean} [sizeMismatch]
 * @property {{ width: number, height: number }} [dimensionDifference]
 * @property {string} [message]
 * @property {string} beforeImage
 * @property {string} afterImage
 * @property {string} [diffImage]
 * @property {string} [beforeCapturedAt]
 * @property {string} [afterCapturedAt]
 */

/**
 * @typedef {object} CompareInfo
 * @property {number} nextStart
 * @property {number} total
 * @property {number} identicalSkipped
 * @property {boolean} done
 * @property {number} onlyBefore
 * @property {number} onlyAfter
 * @property {VisualDiffInfo[]} results
 */

export class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/**
 * Small client for the dops API. The token is sent as a bearer header and,
 * for WebSockets, as a query parameter.
 *
 * @param {string} token
 * @param {string} [base] Origin of the API, empty for same-origin.
 */
export function createApi(token, base = '') {
  /**
   * @template T
   * @param {string} path
   * @param {RequestInit} [init]
   * @returns {Promise<T>}
   */
  async function request(path, init = {}) {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (response.status === 204) return /** @type {T} */ (undefined);
    if (!response.ok) {
      const body = /** @type {{ error?: string }} */ (await response.json().catch(() => ({})));
      throw new ApiError(response.status, body.error ?? response.statusText);
    }
    const type = response.headers.get('content-type') ?? '';
    return /** @type {Promise<T>} */ (
      type.includes('application/json') ? response.json() : response.text()
    );
  }

  return {
    /** @returns {Promise<PipelineInfo[]>} */
    pipelines: () => request('/api/pipelines'),
    /** @returns {Promise<TargetInfo[]>} */
    targets: () => request('/api/targets'),
    /** @returns {Promise<string[]>} */
    sites: () => request('/api/sites'),
    /** @returns {Promise<ParamInfo[]>} */
    params: () => request('/api/params'),
    /**
     * @param {string} name
     * @param {{ description?: string, targets: string[], steps: StepInfo[] }} pipeline
     */
    savePipeline: (name, pipeline) =>
      request(`/api/pipelines/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(pipeline),
      }),
    /** @param {string} name */
    deletePipeline: (name) =>
      request(`/api/pipelines/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    /**
     * @param {string} name
     * @param {{ description?: string, default?: string }} param
     */
    saveParam: (name, param) =>
      request(`/api/params/${encodeURIComponent(name)}`, {
        method: 'PUT',
        body: JSON.stringify(param),
      }),
    /** @param {string} name */
    deleteParam: (name) => request(`/api/params/${encodeURIComponent(name)}`, { method: 'DELETE' }),
    /** @returns {Promise<Record<string, string[]>>} */
    siteParams: () => request('/api/site-params'),
    /**
     * @param {{ pipeline: string, targets?: string[], site?: string, params?: Record<string, string> }} body
     * @returns {Promise<{ id: string }>}
     */
    startRun: (body) => request('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
    /**
     * @param {{ command: string, targets: string[], site?: string, params?: Record<string, string> }} body
     * @returns {Promise<{ id: string }>}
     */
    runCommand: (body) => request('/api/commands', { method: 'POST', body: JSON.stringify(body) }),
    /** @returns {Promise<import('./components/History.jsx').RunSummary[]>} */
    runs: () => request('/api/runs'),
    /** @param {string} id */
    cancelRun: (id) => request(`/api/runs/${id}/cancel`, { method: 'POST' }),
    /**
     * @param {string} id
     * @returns {Promise<string>}
     */
    runLog: (id) => request(`/api/runs/${id}/log`),
    /** Sets the HttpOnly cookie that lets <img> tags load screenshots. */
    startSession: () => request('/api/session', { method: 'POST' }),
    endSession: () => request('/api/session', { method: 'DELETE' }),
    /** @returns {Promise<{ job: CaptureJobInfo | null, counts: { before: number, after: number } }>} */
    visualWorkspace: () => request('/api/visual/workspace'),
    /**
     * @param {object} body
     * @returns {Promise<CaptureJobInfo>}
     */
    visualCapture: (body) =>
      request('/api/visual/workspace/capture', { method: 'POST', body: JSON.stringify(body) }),
    visualCancel: () => request('/api/visual/workspace/cancel', { method: 'POST' }),
    /**
     * @param {number} start
     * @param {number} limit
     * @returns {Promise<CompareInfo>}
     */
    visualCompare: (start, limit) =>
      request('/api/visual/workspace/compare', {
        method: 'POST',
        body: JSON.stringify({ start, limit }),
      }),
    visualClear: () => request('/api/visual/workspace', { method: 'DELETE' }),
    /**
     * Subscribes to a run's events; returns a function that closes the socket.
     *
     * @param {string} id
     * @param {(event: any) => void} onEvent
     */
    streamRun(id, onEvent) {
      const origin = base || window.location.origin;
      const url = new URL(`/api/runs/${id}/events`, origin.replace(/^http/, 'ws'));
      url.searchParams.set('token', token);
      const socket = new WebSocket(url);
      socket.onmessage = (message) => onEvent(JSON.parse(message.data));
      return () => socket.close();
    },
  };
}

/** @typedef {ReturnType<typeof createApi>} Api */
