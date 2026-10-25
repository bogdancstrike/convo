import { describe, expect, it, vi } from 'vitest';
import { normalizeCallLinkPath } from './CallLinks';

describe('call link paths (Android App Links)', () => {
  const token = 'A'.repeat(43);
  const run = (pathname: string) => {
    const replaceState = vi.fn();
    normalizeCallLinkPath({ pathname } as Location, { replaceState } as unknown as History);
    return replaceState.mock.calls[0]?.[2];
  };
  it('turns /call/<token> into the app route', () => { expect(run(`/call/${token}`)).toBe(`/#/call/${token}`); });
  it('leaves other paths and malformed tokens alone', () => {
    expect(run('/')).toBeUndefined();
    expect(run('/call/short')).toBeUndefined();
    expect(run(`/auth/call/${token}`)).toBeUndefined();
  });
});
