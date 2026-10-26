/**
 * jsdom gaps Ant Design relies on. Loaded by component tests (`// @vitest-environment jsdom`) through
 * vite.config.ts setupFiles; harmless in the node environment.
 */
import { afterEach } from 'vitest';

if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react');
  afterEach(() => cleanup());
  window.matchMedia ??= ((query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => undefined, removeListener: () => undefined,
    addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  // antd measures scrollbars through getComputedStyle with a pseudo-element, which jsdom does not implement.
  const computed = window.getComputedStyle.bind(window);
  window.getComputedStyle = (element: Element) => computed(element);
}
