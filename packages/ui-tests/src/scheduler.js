import cron from 'node-cron';

/**
 * @import { UiSchedule } from '@dops/core'
 * @import { ScheduledTask } from 'node-cron'
 */

/**
 * @typedef {object} ScheduledSuite
 * @property {UiSchedule} schedule
 * @property {ScheduledTask} task
 */

/**
 * Starts a cron task per schedule. A suite never runs twice at the same time:
 * when its previous run is still going, the new trigger is skipped.
 *
 * @param {UiSchedule[]} schedules
 * @param {object} handlers
 * @param {(schedule: UiSchedule) => Promise<unknown>} handlers.run
 * @param {(suite: string) => void} [handlers.onSkip]
 * @param {(suite: string, error: unknown) => void} [handlers.onError]
 * @returns {{ scheduled: ScheduledSuite[], stop: () => Promise<void> }}
 */
export function startScheduler(schedules, { run, onSkip, onError }) {
  const invalid = schedules.filter((s) => !cron.validate(s.cron)).map((s) => `"${s.cron}"`);
  if (invalid.length) throw new Error(`Invalid cron expression: ${invalid.join(', ')}`);

  /** @type {Set<string>} */
  const running = new Set();
  const scheduled = schedules.map((schedule) => {
    const task = cron.schedule(
      schedule.cron,
      async () => {
        if (running.has(schedule.suite)) {
          onSkip?.(schedule.suite);
          return;
        }
        running.add(schedule.suite);
        try {
          await run(schedule);
        } catch (error) {
          onError?.(schedule.suite, error);
        } finally {
          running.delete(schedule.suite);
        }
      },
      {
        name: `ui-tests:${schedule.suite}`,
        ...(schedule.timezone ? { timezone: schedule.timezone } : {}),
      },
    );
    return { schedule, task };
  });

  return {
    scheduled,
    stop: async () => {
      await Promise.all(scheduled.map(({ task }) => task.destroy()));
    },
  };
}

/** @param {string} expression */
export function isValidCron(expression) {
  return cron.validate(expression);
}
