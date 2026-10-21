import { expect, it } from 'vitest';
import { isSnoozed, thisEvening, tomorrowMorning } from './snooze';

it('resolves evening and morning presets in local time', () => {
  const morning = new Date(2026, 9, 21, 10, 30);
  expect(thisEvening(morning)).toEqual(new Date(2026, 9, 21, 18, 0));
  const late = new Date(2026, 9, 21, 19, 15);
  expect(thisEvening(late)).toEqual(new Date(2026, 9, 22, 18, 0)); // already past 18:00
  expect(tomorrowMorning(late)).toEqual(new Date(2026, 9, 22, 9, 0));
  expect(tomorrowMorning(new Date(2026, 11, 31, 23, 0))).toEqual(new Date(2027, 0, 1, 9, 0));
});

it('is active only before its deadline', () => {
  expect(isSnoozed(undefined)).toBe(false);
  expect(isSnoozed({ until: 2000, zone: 'UTC' }, 1000)).toBe(true);
  expect(isSnoozed({ until: 2000, zone: 'UTC' }, 2000)).toBe(false);
});
