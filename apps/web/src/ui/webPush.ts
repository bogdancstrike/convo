import type { EnclaveClient } from '../core/client';
import { deploymentInfo } from '../config/deployment';

/**
 * Web Push for closed tabs (MSG-02). The browser subscribes with the deployment's VAPID key and
 * the endpoint is registered for this device; wakes are empty, so the browser's push service
 * (Google, Mozilla, Apple, Microsoft) learns only that some mail is waiting. The subscription
 * itself is the on/off state, per browser profile.
 */
export function webPushKey(): string | null {
  return deploymentInfo()?.push?.webPushKey ?? null;
}

export function webPushSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined'
    && 'PushManager' in window && typeof Notification !== 'undefined' && webPushKey() !== null;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  return navigator.serviceWorker.ready;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Whether this browser currently has a subscription for this deployment. */
export async function webPushEnabled(): Promise<boolean> {
  if (!webPushSupported()) return false;
  const existing = await navigator.serviceWorker.getRegistration('/');
  return !!(await existing?.pushManager.getSubscription());
}

/** Asks for permission, subscribes and registers the endpoint. Returns false when not allowed. */
export async function enableWebPush(client: EnclaveClient): Promise<boolean> {
  const key = webPushKey();
  if (!webPushSupported() || !key) return false;
  if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return false;
  const reg = await registration();
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with an older key cannot be reused after the deployment rotates it.
  const current = subscription?.options.applicationServerKey;
  if (subscription && current && !sameBytes(new Uint8Array(current), keyBytes(key))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await client.setPushEndpoint(subscription.endpoint);
  return true;
}

export async function disableWebPush(client: EnclaveClient): Promise<void> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  const subscription = await existing?.pushManager.getSubscription();
  await subscription?.unsubscribe();
  await client.setPushEndpoint(null);
}

/**
 * Start-up sync: an existing subscription is registered again (the server forgets endpoints the
 * push service reports gone, and a rotated key needs a fresh subscription). Never prompts.
 */
export async function syncWebPush(client: EnclaveClient): Promise<void> {
  if (!webPushSupported() || Notification.permission !== 'granted' || !(await webPushEnabled())) return;
  await enableWebPush(client);
}
