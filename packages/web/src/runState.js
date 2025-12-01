/**
 * Turns the event stream of a run into what the run view renders. Pure, so
 * it is tested without a browser.
 */

/**
 * @typedef {object} StepView
 * @property {string} key
 * @property {string} target
 * @property {number} index
 * @property {string} name
 * @property {string} command
 * @property {'running' | 'ok' | 'failed' | 'skipped'} status
 * @property {number} [code]
 * @property {number} [durationMs]
 * @property {string} output
 */

/**
 * @typedef {object} RunView
 * @property {string} pipeline
 * @property {string[]} targets
 * @property {'connecting' | 'running' | 'ok' | 'failed' | 'cancelled' | 'unknown'} status
 * @property {StepView[]} steps
 */

/** @type {RunView} */
export const initialRunView = { pipeline: '', targets: [], status: 'connecting', steps: [] };

/**
 * @param {string} target
 * @param {number} index
 */
const stepKey = (target, index) => `${target}#${index}`;

/**
 * @param {RunView} state
 * @param {string} key
 * @param {(step: StepView) => StepView} update
 * @returns {RunView}
 */
function updateStep(state, key, update) {
  return { ...state, steps: state.steps.map((step) => (step.key === key ? update(step) : step)) };
}

/**
 * @param {RunView} state
 * @param {any} event A RunEvent from the server, or { type: 'unknown-run' }.
 * @returns {RunView}
 */
export function runReducer(state, event) {
  switch (event.type) {
    case 'run-start':
      return { ...state, pipeline: event.pipeline, targets: event.targets, status: 'running' };
    case 'step-start':
      return {
        ...state,
        steps: [
          ...state.steps,
          {
            key: stepKey(event.target, event.index),
            target: event.target,
            index: event.index,
            name: event.name,
            command: event.command,
            status: 'running',
            output: '',
          },
        ],
      };
    case 'output':
      return updateStep(state, stepKey(event.target, event.index), (step) => ({
        ...step,
        output: step.output + event.text,
      }));
    case 'step-end': {
      const key = stepKey(event.target, event.index);
      const { status, code, durationMs, name, command } = event.step;
      if (!state.steps.some((step) => step.key === key)) {
        // Skipped steps never started.
        return {
          ...state,
          steps: [
            ...state.steps,
            { key, target: event.target, index: event.index, name, command, status, output: '' },
          ],
        };
      }
      return updateStep(state, key, (step) => ({ ...step, status, code, durationMs }));
    }
    case 'run-end': {
      const { record } = event;
      if (state.steps.length) return { ...state, status: record.status };
      // Finished before we subscribed: show the stored steps.
      return {
        pipeline: record.pipeline,
        targets: record.targets,
        status: record.status,
        steps: record.steps.map((/** @type {any} */ step, /** @type {number} */ i) => ({
          ...step,
          key: `${step.target}#${i}`,
          index: i,
          output: '',
        })),
      };
    }
    case 'unknown-run':
      return { ...state, status: 'unknown' };
    default:
      return state;
  }
}
