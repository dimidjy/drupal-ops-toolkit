/**
 * @typedef {object} PipelineInfo
 * @property {string} name
 * @property {string | null} description
 * @property {string[]} targets
 * @property {{ name: string, run: string }[]} steps
 */

/**
 * @typedef {object} TargetInfo
 * @property {string} name
 * @property {string | null} environment
 * @property {string} host
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
    /**
     * @param {{ pipeline: string, targets?: string[], site?: string }} body
     * @returns {Promise<{ id: string }>}
     */
    startRun: (body) => request('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
    /** @param {string} id */
    cancelRun: (id) => request(`/api/runs/${id}/cancel`, { method: 'POST' }),
    /**
     * @param {string} id
     * @returns {Promise<string>}
     */
    runLog: (id) => request(`/api/runs/${id}/log`),
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
