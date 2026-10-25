import { describe, expect, it } from 'vitest';
import { CONTENT_VERSION, decodeContent, encodeContent } from '../crypto/content';
import { applyRsvp, applyUpdate, closesAt, initialEvent, newEvent, reminderAt, responses, toIcs } from './events';

const start = Date.UTC(2026, 10, 1, 18, 0);
const base = () => initialEvent(newEvent({ title: 'Team dinner', start, end: start + 2 * 3600_000, zone: 'Europe/Bucharest', location: 'Old Town' }));

describe('events with RSVP (FR-EXT-01)', () => {
  it('validates input: title, end after start', () => {
    expect(() => newEvent({ title: ' ', start })).toThrow();
    expect(() => newEvent({ title: 'x', start, end: start })).toThrow();
    expect(newEvent({ title: ' Hike ', start, zone: 'UTC' }).title).toBe('Hike');
  });

  it('keeps the newest answer per member regardless of order', () => {
    const a = applyRsvp(applyRsvp(base(), 'ana', 'maybe', 1, 'm1'), 'ana', 'going', 2, 'm2');
    const b = applyRsvp(applyRsvp(base(), 'ana', 'going', 2, 'm2'), 'ana', 'maybe', 1, 'm1');
    expect(a).toEqual(b);
    expect(responses(a)).toEqual({ going: ['ana'], maybe: [], no: [] });
  });

  it('applies only newer revisions; cancellation closes responses', () => {
    const moved = applyUpdate(base(), 2, { ...base(), title: 'Team dinner (moved)', start: start + 3600_000, end: start + 3 * 3600_000 }, false, 10);
    expect(applyUpdate(moved, 1, { ...base(), title: 'old' }, false, 11).title).toBe('Team dinner (moved)');
    const cancelled = applyUpdate(moved, 3, moved, true, 50);
    expect(closesAt(cancelled)).toBe(50);
    expect(applyRsvp(cancelled, 'bob', 'going', 60, 'x')).toBe(cancelled);
    expect(applyRsvp(cancelled, 'bob', 'going', 40, 'x').rsvps.bob?.response).toBe('going');
  });

  it('closes late responses after the event ends', () => {
    expect(applyRsvp(base(), 'cy', 'going', start + 3 * 3600_000, 'late').rsvps.cy).toBeUndefined();
  });

  it('round-trips through the codec and exports an iCalendar file', () => {
    const event = newEvent({ title: 'Launch; party', start, zone: 'UTC', location: 'Hall, 2nd floor' });
    const bytes = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, body: event.title, event } });
    expect(decodeContent(bytes)).toMatchObject({ data: { event } });
    const bad = encodeContent({ v: CONTENT_VERSION, kind: 'data', data: { messageId: 'm', timestamp: 1, event: { ...event, end: start - 1 } } });
    expect(() => decodeContent(bad)).toThrow();
    const ics = toIcs(initialEvent(event), 'abc');
    expect(ics).toContain(String.raw`SUMMARY:Launch\; party`);
    expect(ics).toContain('LOCATION:Hall\\, 2nd floor');
    expect(ics).toContain('DTSTART:20261101T180000Z');
  });
});

describe('local event reminders', () => {
  const base = { ...initialEvent({ title: 'Hike', start: 10 * 3_600_000, zone: 'UTC' }) };
  const going = applyRsvp(base, 'me', 'going', 1, 'a');
  it('fires the lead time before start for Going and Maybe answers only', () => {
    expect(reminderAt(going, 'me', 15, 0)).toBe(10 * 3_600_000 - 15 * 60_000);
    expect(reminderAt(applyRsvp(base, 'me', 'maybe', 1, 'a'), 'me', 15, 0)).toBeDefined();
    expect(reminderAt(applyRsvp(base, 'me', 'no', 1, 'a'), 'me', 15, 0)).toBeUndefined();
    expect(reminderAt(base, 'me', 15, 0)).toBeUndefined();
  });
  it('is off when disabled, cancelled or already started', () => {
    expect(reminderAt(going, 'me', 0, 0)).toBeUndefined();
    expect(reminderAt(applyUpdate(going, 1, { title: 'Hike', start: going.start, zone: 'UTC' }, true, 2), 'me', 15, 0)).toBeUndefined();
    expect(reminderAt(going, 'me', 15, going.start)).toBeUndefined();
  });
});
