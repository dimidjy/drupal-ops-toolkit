import pc from 'picocolors';

/** @import { RunEvent } from '@dops/core' */

/**
 * Formats runner events for a terminal. Output text is passed through as is;
 * step headers and results are colour-coded.
 *
 * @param {RunEvent} event
 * @returns {string}
 */
export function formatEvent(event) {
  switch (event.type) {
    case 'run-start':
      return `${pc.bold(`▶ ${event.pipeline}`)} on ${event.targets.join(', ')}\n`;
    case 'step-start':
      return `\n${pc.cyan(`[${event.target}]`)} ${pc.bold(event.name)}\n${pc.dim(`$ ${event.command}`)}\n`;
    case 'output':
      return event.stream === 'stderr' ? pc.yellow(event.text) : event.text;
    case 'step-end': {
      const { step } = event;
      if (step.status === 'skipped') {
        return `${pc.dim(`[${step.target}] ${step.name}: skipped`)}\n`;
      }
      const seconds = (step.durationMs / 1000).toFixed(1);
      return step.status === 'ok'
        ? `${pc.green(`✔ ${step.name}`)} ${pc.dim(`${seconds}s`)}\n`
        : `${pc.red(`✖ ${step.name} (exit ${step.code})`)} ${pc.dim(`${seconds}s`)}\n`;
    }
    case 'run-end': {
      const { record } = event;
      const colour = record.status === 'ok' ? pc.green : pc.red;
      return `\n${colour(pc.bold(`${record.pipeline}: ${record.status}`))} ${pc.dim(record.id)}\n`;
    }
  }
}
