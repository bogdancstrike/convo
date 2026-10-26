// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../test/render';
import { AdminError, type OrgPolicy, type Permission } from '../api';

const { api } = vi.hoisted(() => ({ api: { policy: vi.fn(), publishPolicy: vi.fn() } }));
vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api }));
import { PolicyPage } from './Policy';

const POLICY: OrgPolicy = {
  notifications: { maxPreview: 'sender' },
  security: { screenshotBlock: false, appLockRequired: true, appLockMaxMinutes: 5, keyTransparencyBlock: false },
  privacy: { readReceiptsDefault: true, typingDefault: true },
  features: { chatExport: true, viewOnce: true, stickers: true, callLinks: false },
};
const signed = { keyId: 'policy-key-1', publishedAt: '2026-10-01T10:00:00Z', publishedBy: 'ana' };
const page = (permissions: Permission[]) => renderWithApp(<PolicyPage can={(p: Permission) => permissions.includes(p)} navigate={() => undefined} param="" />);

/** Types the audit reason into the confirmation and confirms. */
async function confirmReason(reason: string) {
  fireEvent.change(await screen.findByTestId('reason-input'), { target: { value: reason } });
  fireEvent.click(screen.getByTestId('reason-confirm'));
}

beforeEach(() => { vi.resetAllMocks(); api.policy.mockResolvedValue({ version: 4, policy: POLICY, signed }); });

describe('Organization policy page', () => {
  it('shows the version in force, who published it and the signing key', async () => {
    page(['POLICY_READ']);
    const version = await screen.findByTestId('policy-version');
    expect(version.textContent).toContain('4');
    expect(version.textContent).toContain('ana');
    expect(version.textContent).toContain('policy-key-1');
  });

  it('loads the stored switches', async () => {
    page(['POLICY_READ', 'POLICY_MANAGE']);
    expect((await screen.findByTestId('policy-security-appLockRequired')).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('policy-features-callLinks').getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('policy-security-keyTransparencyBlock').getAttribute('aria-checked')).toBe('false');
  });

  it('read-only roles see disabled switches and no publish button', async () => {
    page(['POLICY_READ']);
    const lock = await screen.findByTestId('policy-security-appLockRequired');
    expect(lock.hasAttribute('disabled') || lock.className.includes('disabled')).toBe(true);
    expect(screen.queryByTestId('policy-publish')).toBeNull();
    expect(screen.getByText('Your admin role can view the policy but not change it.')).toBeTruthy();
  });

  it('without a published policy, defaults apply', async () => {
    api.policy.mockResolvedValue({ version: 0, policy: POLICY, signed: null });
    page(['POLICY_READ']);
    expect((await screen.findByTestId('policy-version')).textContent).toContain('none published (defaults apply)');
  });

  it('publishes the edited policy against the version it was based on, with the reason', async () => {
    api.publishPolicy.mockResolvedValue({ version: 5, keyId: 'policy-key-1' });
    page(['POLICY_READ', 'POLICY_MANAGE']);
    fireEvent.click(await screen.findByTestId('policy-security-keyTransparencyBlock'));
    fireEvent.click(screen.getByTestId('policy-publish'));
    await confirmReason('incident 42');
    await waitFor(() => expect(api.publishPolicy).toHaveBeenCalled());
    const [expected, policy, reason] = api.publishPolicy.mock.calls[0]!;
    expect(expected).toBe(4);
    expect(reason).toBe('incident 42');
    expect(policy.security.keyTransparencyBlock).toBe(true);
    expect(policy.security.appLockRequired).toBe(true);
    await waitFor(() => expect(api.policy).toHaveBeenCalledTimes(2));
  });

  it('cancelling the reason publishes nothing', async () => {
    page(['POLICY_READ', 'POLICY_MANAGE']);
    fireEvent.click(await screen.findByTestId('policy-publish'));
    await screen.findByTestId('reason-input');
    fireEvent.click(screen.getByText('Cancel'));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.publishPolicy).not.toHaveBeenCalled();
  });

  it('a missing reason is explained in place and the dialog stays open', async () => {
    api.publishPolicy.mockResolvedValue({ version: 5, keyId: 'k' });
    page(['POLICY_READ', 'POLICY_MANAGE']);
    fireEvent.click(await screen.findByTestId('policy-publish'));
    await confirmReason('   ');
    expect(await screen.findByTestId('reason-required')).toBeTruthy();
    expect(api.publishPolicy).not.toHaveBeenCalled();
    await confirmReason('now with a reason');
    await waitFor(() => expect(api.publishPolicy).toHaveBeenCalledWith(4, expect.anything(), 'now with a reason'));
  });

  it('a concurrent edit reloads the newer version instead of overwriting it', async () => {
    api.publishPolicy.mockRejectedValue(new AdminError(409, 'CONFLICT'));
    page(['POLICY_READ', 'POLICY_MANAGE']);
    fireEvent.click(await screen.findByTestId('policy-publish'));
    await confirmReason('tweak');
    expect(await screen.findByText(/Someone published a newer version meanwhile/)).toBeTruthy();
    expect(api.policy).toHaveBeenCalledTimes(2);
  });

  it('load errors are shown instead of the form', async () => {
    api.policy.mockRejectedValue(new AdminError(403, 'FORBIDDEN_ROLE'));
    page(['POLICY_READ']);
    expect(await screen.findByText('Your admin role does not allow this.')).toBeTruthy();
    expect(screen.queryByTestId('policy-page')).toBeNull();
  });
});
