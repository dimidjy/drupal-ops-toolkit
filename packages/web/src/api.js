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

/**
 * @typedef {object} FindingInfo
 * @property {string} file
 * @property {number | null} [line]
 * @property {'info' | 'minor' | 'major' | 'critical'} severity
 * @property {string} message
 */

/**
 * @typedef {object} ReviewRecord
 * @property {string} id
 * @property {string | null} sha
 * @property {string} subject
 * @property {string} provider
 * @property {string} createdAt
 * @property {{ summary: string, verdict: 'approve' | 'comment' | 'request_changes', findings: FindingInfo[] }} review
 */

/**
 * @typedef {object} JiraIssueInfo
 * @property {string} key
 * @property {string} summary
 * @property {string} status
 * @property {string} issue_type
 * @property {string | null} [priority]
 * @property {string | null} [assignee]
 * @property {string[]} labels
 * @property {string} description
 * @property {string | null} [updated]
 */

/**
 * @typedef {object} IssueDetailsInfo
 * @property {JiraIssueInfo} issue
 * @property {string} url
 * @property {{ author: string, created: string | null, body: string }[]} comments
 * @property {JiraIssueInfo[]} related
 * @property {object | null} raw
 * @property {{ summary: string, acceptance_criteria: string[], technical_notes: string[],
 *   risks: string[], questions: string[], suggested_steps: string[] } | null} analysis
 */

/**
 * @typedef {object} BoardReportInfo
 * @property {string} id
 * @property {string} jql
 * @property {string} generated_at
 * @property {Record<string, number>} counts
 * @property {string[]} stale
 * @property {JiraIssueInfo[]} issues
 * @property {{ summary: string, risks: string[], blocked: string[] } | null} summary
 */

/**
 * @typedef {object} PairsJobInfo
 * @property {'running' | 'done' | 'failed' | 'cancelled'} status
 * @property {number} total
 * @property {number} captured
 * @property {{ side: 'A' | 'B', url: string, error: string }[]} errors
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {string} [error]
 */

/**
 * @typedef {object} PairInfo
 * @property {number} index
 * @property {string} urlA
 * @property {string} urlB
 * @property {'identical' | 'different' | 'error'} status
 * @property {number} [diffPercent]
 * @property {{ width: number, height: number }} [sizeA]
 * @property {{ width: number, height: number }} [sizeB]
 * @property {boolean} [sizeMismatch]
 * @property {string} [message]
 * @property {string} [imageA]
 * @property {string} [imageB]
 * @property {string} [diffImage]
 */

/**
 * @typedef {object} TestSuiteInfo
 * @property {string} name
 * @property {string} baseUrl
 * @property {string[]} schedules
 * @property {boolean} running
 */

/**
 * @typedef {object} TestRunInfo
 * @property {string} id
 * @property {string} suite
 * @property {'running' | 'passed' | 'failed' | 'error'} status
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {{ passed: number, failed: number, flaky: number, skipped: number, durationMs: number }} [stats]
 * @property {{ title: string, file: string, line: number, error: string }[]} failures
 * @property {string | null} [reportUrl]
 * @property {string} [error]
 */

/**
 * @typedef {object} VisualReportInfo
 * @property {string} set
 * @property {string} name
 * @property {string} url
 * @property {string} modifiedAt
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
    /** @returns {Promise<{ job: PairsJobInfo | null, result: { createdAt: string, results: PairInfo[] } | null }>} */
    pairs: () => request('/api/visual/pairs'),
    /** @param {object} body */
    startPairs: (body) =>
      request('/api/visual/pairs', { method: 'POST', body: JSON.stringify(body) }),
    cancelPairs: () => request('/api/visual/pairs/cancel', { method: 'POST' }),
    clearPairs: () => request('/api/visual/pairs', { method: 'DELETE' }),
    /**
     * @param {number} [limit]
     * @returns {Promise<{ sha: string, author: string, date: string, subject: string }[]>}
     */
    commits: (limit = 15) => request(`/api/git/commits?limit=${limit}`),
    /**
     * @param {{ sha?: string, provider?: string }} body
     * @returns {Promise<ReviewRecord>}
     */
    reviewCommit: (body) =>
      request('/api/ai/reviews', { method: 'POST', body: JSON.stringify(body) }),
    /** @returns {Promise<{ id: string, sha: string | null, subject: string, provider: string, createdAt: string, verdict: string, findings: number }[]>} */
    reviews: () => request('/api/ai/reviews'),
    /**
     * @param {string} id
     * @returns {Promise<ReviewRecord>}
     */
    review: (id) => request(`/api/ai/reviews/${encodeURIComponent(id)}`),
    /**
     * @param {{ key: string, related?: boolean, analyze?: boolean, provider?: string }} body
     * @returns {Promise<IssueDetailsInfo>}
     */
    jiraIssue: (body) => request('/api/jira/issue', { method: 'POST', body: JSON.stringify(body) }),
    /**
     * @param {{ jql?: string, limit?: number, summarize?: boolean, provider?: string }} body
     * @returns {Promise<BoardReportInfo>}
     */
    jiraBoard: (body) => request('/api/jira/board', { method: 'POST', body: JSON.stringify(body) }),
    /** @returns {Promise<{ id: string, jql: string, generatedAt: string, issues: number, stale: number, summarized: boolean }[]>} */
    boardReports: () => request('/api/jira/board/reports'),
    /**
     * @param {string} id
     * @returns {Promise<BoardReportInfo>}
     */
    boardReport: (id) => request(`/api/jira/board/reports/${encodeURIComponent(id)}`),
    clearBoardReports: () => request('/api/jira/board/reports', { method: 'DELETE' }),
    /** @returns {Promise<TestSuiteInfo[]>} */
    testSuites: () => request('/api/tests/suites'),
    /** @returns {Promise<TestRunInfo[]>} */
    testRuns: () => request('/api/tests/runs'),
    /** @param {string} suite */
    startTests: (suite) =>
      request('/api/tests/runs', { method: 'POST', body: JSON.stringify({ suite }) }),
    /** @returns {Promise<VisualReportInfo[]>} */
    visualReports: () => request('/api/visual/reports'),
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
