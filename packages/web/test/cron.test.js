import { describe, expect, it } from 'vitest';
import { describeCron, toCron } from '../src/cron.js';

describe('schedule shapes', () => {
  it('turns choices into cron and back', () => {
    expect(toCron({ mode: 'daily', time: '07:30' })).toBe('30 7 * * *');
    expect(toCron({ mode: 'weekdays', time: '06:05' })).toBe('5 6 * * 1-5');
    expect(toCron({ mode: 'every', minutes: 2 })).toBe('*/5 * * * *');
    expect(describeCron('30 7 * * *')).toBe('daily at 07:30');
    expect(describeCron('5 6 * * 1-5')).toBe('weekdays at 06:05');
    expect(describeCron('*/15 * * * *')).toBe('every 15 minutes');
    expect(describeCron('0 3 1 * *')).toBe('0 3 1 * *');
  });
});
