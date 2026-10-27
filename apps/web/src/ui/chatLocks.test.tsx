// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('./passkeyUnlock', async (original) => ({ ...(await original<typeof import('./passkeyUnlock')>()), verifyWithPasskey: verify }));
import { PasskeyUnavailableError } from './passkeyUnlock';
import { ChatLockProvider, LockedChatGate, useChatLocks } from './chatLocks';
import { I18nProvider } from './i18n/i18n';

/** Minimal client: settings, credential events and the two lock setters. */
function fakeClient({ passkey = true as boolean | null, lockedChats = [] as string[], appLock = false } = {}) {
  const listeners = new Map<string, ((v: unknown) => void)[]>();
  const client = {
    passkeyEnrolled: passkey,
    settings: { lockedChats, appLock, appLockAfterMinutes: 0 },
    policy: { security: { appLockMaxMinutes: 60 } },
    on: (event: string, fn: (v: unknown) => void) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); return () => undefined; },
    emit: (event: string, value: unknown) => listeners.get(event)?.forEach((fn) => fn(value)),
    credentialStatus: vi.fn(async () => ({ state: 'available', passkey, otp: false })),
    setChatLocked: vi.fn(async (id: string, lock: boolean) => {
      client.settings = { ...client.settings, lockedChats: lock ? [...client.settings.lockedChats, id] : client.settings.lockedChats.filter((x) => x !== id) };
      client.emit('settings', client.settings);
    }),
    updateSettings: vi.fn(async (patch: object) => { client.settings = { ...client.settings, ...patch }; client.emit('settings', client.settings); }),
  };
  return client;
}

/** Exposes the lock API to the test. */
let api: ReturnType<typeof useChatLocks>;
function Probe() { api = useChatLocks(); return <div data-testid="content">chats</div>; }
function mount(client: ReturnType<typeof fakeClient>, extra?: React.ReactNode) {
  return render(<I18nProvider locale="en"><ChatLockProvider client={client as never}><Probe />{extra}</ChatLockProvider></I18nProvider>);
}

beforeEach(() => { verify.mockReset(); verify.mockResolvedValue(true); });
afterEach(() => cleanup());

describe('chat locks (web)', () => {
  it('a chat can be locked with a passkey; locked chats are hidden until unlocked', async () => {
    const client = fakeClient();
    mount(client);
    await act(async () => { await api.toggle('c1'); });
    expect(client.setChatLocked).toHaveBeenCalledWith('c1', true);
    expect(api.locked('c1')).toBe(true); expect(api.hidden('c1')).toBe(true);
    await act(async () => { await api.unlock('c1'); });
    expect(api.hidden('c1')).toBe(false); expect(api.unlockedChat).toBe('c1');
    act(() => api.relock());
    expect(api.hidden('c1')).toBe(true);
  });

  it('without a passkey nothing can be locked', async () => {
    const client = fakeClient({ passkey: false });
    mount(client);
    await act(async () => { await api.toggle('c1'); });
    expect(client.setChatLocked).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('a failed verification changes nothing', async () => {
    verify.mockResolvedValue(false);
    const client = fakeClient({ lockedChats: ['c1'] });
    mount(client);
    await act(async () => { await api.toggle('c1'); });
    expect(client.setChatLocked).not.toHaveBeenCalled();
    await act(async () => { expect(await api.unlock('c1')).toBe(false); });
    expect(api.hidden('c1')).toBe(true);
  });

  it('unlocking (removing the lock) works even without a passkey', async () => {
    const client = fakeClient({ passkey: false, lockedChats: ['c1'] });
    mount(client);
    await act(async () => { await api.toggle('c1'); });
    expect(client.setChatLocked).toHaveBeenCalledWith('c1', false);
  });

  it('a browser without passkey support explains where it works', async () => {
    verify.mockRejectedValue(new PasskeyUnavailableError());
    mount(fakeClient());
    await act(async () => { await api.verify(); });
    expect(api.error).toBeTruthy();
    act(() => api.clearError());
    expect(api.error).toBeNull();
  });

  it('a chat opened from the verified locked list is granted', () => {
    mount(fakeClient({ lockedChats: ['c1'] }));
    act(() => api.grant('c1'));
    expect(api.hidden('c1')).toBe(false);
  });

  it('the gate unlocks the chat after the passkey', async () => {
    const onBack = vi.fn();
    mount(fakeClient({ lockedChats: ['c1'] }), <LockedChatGate conversationId="c1" onBack={onBack} />);
    await act(async () => { fireEvent.click(screen.getByTestId('unlock-chat')); });
    expect(api.unlockedChat).toBe('c1');
    fireEvent.click(screen.getByText(/back/i));
    expect(onBack).toHaveBeenCalled();
  });
});

describe('app lock (web)', () => {
  it('when on, nothing renders until the passkey is verified', async () => {
    verify.mockResolvedValueOnce(false);
    mount(fakeClient({ appLock: true }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('app-locked')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();
    verify.mockResolvedValue(true);
    await act(async () => { fireEvent.click(screen.getByTestId('unlock-app')); });
    expect(screen.getByTestId('content')).toBeTruthy();
  });

  it('turning it on needs a passkey and a verification', async () => {
    const client = fakeClient({ passkey: false });
    mount(client);
    await act(async () => { await api.setAppLock(true); });
    expect(client.updateSettings).not.toHaveBeenCalled();
    const withKey = fakeClient();
    cleanup(); mount(withKey);
    await act(async () => { await api.setAppLock(true); });
    expect(withKey.updateSettings).toHaveBeenCalledWith({ appLock: true });
  });

  it('hiding the tab locks again immediately when the delay is zero', async () => {
    // The lock screen asks once on mount; a successful verification shows the app.
    mount(fakeClient({ appLock: true }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('content')).toBeTruthy();
    verify.mockResolvedValue(false); // the person does not confirm this time
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    expect(screen.getByTestId('app-locked')).toBeTruthy();
    expect(screen.queryByTestId('content')).toBeNull();
  });
});
