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

/**
 * Summary of a UI test run: counts, failing tests and where the report is.
 *
 * @param {import('@dops/ui-tests').UiTestRun} run
 */
export function formatTestRun(run) {
  if (run.status === 'error') return `${pc.red('✖ error')} ${run.error ?? ''}\n`;
  const stats = run.stats;
  const seconds = stats ? (stats.durationMs / 1000).toFixed(0) : '?';
  const counts = stats
    ? [
        pc.green(`${stats.passed} passed`),
        stats.failed ? pc.red(`${stats.failed} failed`) : '',
        stats.flaky ? pc.yellow(`${stats.flaky} flaky`) : '',
        stats.skipped ? pc.dim(`${stats.skipped} skipped`) : '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const lines = [
    `${run.status === 'passed' ? pc.green('✔') : pc.red('✖')} ${run.suite}: ${counts} (${seconds}s)`,
  ];
  for (const failure of run.failures) {
    lines.push(`  ${pc.red('✖')} ${failure.title} ${pc.dim(`${failure.file}:${failure.line}`)}`);
    lines.push(`    ${failure.error}`);
  }
  lines.push(pc.dim(`  report: ${run.reportDir}/index.html`));
  return `${lines.join('\n')}\n`;
}
