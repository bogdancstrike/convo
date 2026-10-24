import { expect, it } from 'vitest';
import { USER_CARD, userSystemLayout } from './userSystemLayout';

it('aligns connected account cards and a single identity role on horizontal lines', () => {
  const layout = userSystemLayout(['role:helpdesk'], ['device:1']);
  expect(new Set(['organization', 'person', 'account', 'device:1'].map((id) => layout[id]!.y)).size).toBe(1);
  expect(layout.identity!.y).toBe(layout['role:helpdesk']!.y);
});

it('packs one role and two devices into two rows', () => {
  const layout = userSystemLayout(['role:helpdesk'], ['device:1', 'device:2']);
  expect(Math.max(...Object.values(layout).map((p) => p.y))).toBe(USER_CARD.height + USER_CARD.rowGap);
  expect(layout.identity!.x).toBe(layout.person!.x);
});

it.each([[0, 0], [0, 5], [1, 1], [5, 8], [12, 12]])('keeps %i roles and %i devices apart without clipping the graph origin', (roles, devices) => {
  const layout = userSystemLayout(Array.from({ length: roles }, (_, i) => `role:${i}`), Array.from({ length: devices }, (_, i) => `device:${i}`));
  const positions = Object.values(layout);
  for (const [i, a] of positions.entries()) {
    expect(a.x).toBeGreaterThanOrEqual(0);
    expect(a.y).toBeGreaterThanOrEqual(0);
    for (const b of positions.slice(i + 1)) {
      expect(Math.abs(a.x - b.x) >= USER_CARD.width || Math.abs(a.y - b.y) >= USER_CARD.height).toBe(true);
    }
  }
});
