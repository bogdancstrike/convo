// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('../config/deployment', () => ({ deploymentInfo: info }));
import { disableWebPush, enableWebPush, syncWebPush, webPushEnabled, webPushKey, webPushSupported } from './webPush';

const KEY = 'AQID'; // bytes 1,2,3
const client = { setPushEndpoint: vi.fn(async () => undefined) };

/** A scripted service worker / push manager. */
function browser({ permission = 'granted', request = 'granted', existing = null as null | { key: number[] } } = {}) {
  let subscription = existing ? { endpoint: 'https://push.example/old', options: { applicationServerKey: new Uint8Array(existing.key).buffer }, unsubscribe: vi.fn(async () => { subscription = null; return true; }) } : null;
  const pushManager = {
    getSubscription: vi.fn(async () => subscription),
    subscribe: vi.fn(async (opts: { applicationServerKey: Uint8Array }) => {
      subscription = { endpoint: 'https://push.example/new', options: { applicationServerKey: opts.applicationServerKey.buffer as ArrayBuffer }, unsubscribe: vi.fn(async () => true) };
      return subscription;
    }),
  };
  const registration = { pushManager };
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) } });
  vi.stubGlobal('PushManager', class {});
  (window as unknown as { PushManager: unknown }).PushManager = class {};
  vi.stubGlobal('Notification', { permission, requestPermission: vi.fn(async () => request) });
  return { pushManager };
}

beforeEach(() => { vi.clearAllMocks(); info.mockReturnValue({ push: { webPushKey: KEY } }); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('web push', () => {
  it('needs a deployment key, a service worker, PushManager and Notification', () => {
    browser();
    expect(webPushKey()).toBe(KEY); expect(webPushSupported()).toBe(true);
    info.mockReturnValue({ push: {} });
    expect(webPushSupported()).toBe(false);
  });

  it('subscribes with the deployment key and registers the endpoint', async () => {
    const { pushManager } = browser();
    expect(await enableWebPush(client as never)).toBe(true);
    expect([...pushManager.subscribe.mock.calls[0]![0].applicationServerKey]).toEqual([1, 2, 3]);
    expect(client.setPushEndpoint).toHaveBeenCalledWith('https://push.example/new');
    expect(await webPushEnabled()).toBe(true);
  });

  it('a refused permission subscribes nothing', async () => {
    const { pushManager } = browser({ permission: 'default', request: 'denied' });
    expect(await enableWebPush(client as never)).toBe(false);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('an existing subscription with the current key is reused', async () => {
    const { pushManager } = browser({ existing: { key: [1, 2, 3] } });
    await enableWebPush(client as never);
    expect(pushManager.subscribe).not.toHaveBeenCalled();
    expect(client.setPushEndpoint).toHaveBeenCalledWith('https://push.example/old');
  });

  it('a subscription made with a rotated key is replaced', async () => {
    const { pushManager } = browser({ existing: { key: [9, 9] } });
    await enableWebPush(client as never);
    expect(pushManager.subscribe).toHaveBeenCalled();
    expect(client.setPushEndpoint).toHaveBeenCalledWith('https://push.example/new');
  });

  it('disabling unsubscribes and clears the endpoint', async () => {
    browser({ existing: { key: [1, 2, 3] } });
    await disableWebPush(client as never);
    expect(client.setPushEndpoint).toHaveBeenCalledWith(null);
  });

  it('start-up sync never prompts and only refreshes an existing subscription', async () => {
    const prompt = browser({ permission: 'default' });
    await syncWebPush(client as never);
    expect((Notification as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission).not.toHaveBeenCalled();
    expect(prompt.pushManager.subscribe).not.toHaveBeenCalled();
    vi.clearAllMocks();
    browser({ existing: { key: [1, 2, 3] } });
    await syncWebPush(client as never);
    expect(client.setPushEndpoint).toHaveBeenCalledWith('https://push.example/old');
  });

  it('is off when unsupported', async () => {
    info.mockReturnValue(null);
    browser();
    expect(await webPushEnabled()).toBe(false);
    expect(await enableWebPush(client as never)).toBe(false);
  });
});
