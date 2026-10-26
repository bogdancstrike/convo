// @vitest-environment jsdom
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../test/render';
import { AdminError } from '../api';

const { api } = vi.hoisted(() => ({ api: { integration: vi.fn(), setIntegration: vi.fn() } }));
vi.mock('../api', async (original) => ({ ...(await original<typeof import('../api')>()), api }));
import { IntegrationSection } from './IntegrationSection';

const bot = { kind: 'bot' as const, retention: 'Deleted after 30 days.', setBy: 'ana', setAt: '2026-10-01T10:00:00Z' };

/** Picks an option in the kind select (antd renders options in a portal). */
async function pickKind(label: RegExp) {
  fireEvent.mouseDown(within(screen.getByTestId('integration-kind')).getByRole('combobox'));
  fireEvent.click(await screen.findByText(label, { selector: '.ant-select-item-option-content' }));
}
async function confirmReason(reason: string) {
  fireEvent.change(await screen.findByTestId('reason-input'), { target: { value: reason } });
  fireEvent.click(screen.getByTestId('reason-confirm'));
}

beforeEach(() => { vi.resetAllMocks(); api.setIntegration.mockResolvedValue({}); });

describe('IntegrationSection', () => {
  it('an ordinary account (server omits the field) shows no mark and nothing to save', async () => {
    api.integration.mockResolvedValue({});
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByTestId('integration-section');
    expect(screen.queryByText(/Marked as/)).toBeNull();
    expect(screen.queryByTestId('integration-retention')).toBeNull();
    expect((screen.getByTestId('integration-save') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows who marked an integration account and its retention text', async () => {
    api.integration.mockResolvedValue({ integration: bot });
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    expect(await screen.findByText(/Marked as bot by ana/)).toBeTruthy();
    expect((screen.getByTestId('integration-retention') as HTMLTextAreaElement).value).toBe('Deleted after 30 days.');
  });

  it('marking needs a retention text before it can be saved', async () => {
    api.integration.mockResolvedValue({ integration: null });
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByTestId('integration-section');
    await pickKind(/^Archive/);
    const save = screen.getByTestId('integration-save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('integration-retention'), { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('integration-retention'), { target: { value: '  Kept 7 years.  ' } });
    expect(save.disabled).toBe(false);
  });

  it('saves the mark with trimmed retention and the audit reason, then reloads', async () => {
    api.integration.mockResolvedValue({ integration: null });
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByTestId('integration-section');
    await pickKind(/^Archive/);
    fireEvent.change(screen.getByTestId('integration-retention'), { target: { value: '  Kept 7 years.  ' } });
    fireEvent.click(screen.getByTestId('integration-save'));
    await confirmReason('compliance archive');
    await waitFor(() => expect(api.setIntegration).toHaveBeenCalledWith('acc-1', 'archive', 'Kept 7 years.', 'compliance archive'));
    await waitFor(() => expect(api.integration).toHaveBeenCalledTimes(2));
  });

  it('removing the mark sends kind null', async () => {
    api.integration.mockResolvedValue({ integration: bot });
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByText(/Marked as bot/);
    await pickKind(/^Ordinary account/);
    fireEvent.click(screen.getByTestId('integration-save'));
    await confirmReason('bot retired');
    await waitFor(() => expect(api.setIntegration).toHaveBeenCalledWith('acc-1', null, expect.any(String), 'bot retired'));
  });

  it('a cancelled reason saves nothing', async () => {
    api.integration.mockResolvedValue({ integration: bot });
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByText(/Marked as bot/);
    fireEvent.change(screen.getByTestId('integration-retention'), { target: { value: 'Deleted after 7 days.' } });
    fireEvent.click(screen.getByTestId('integration-save'));
    await screen.findByTestId('reason-input');
    fireEvent.click(screen.getByText('Cancel'));
    await new Promise((r) => setTimeout(r, 50));
    expect(api.setIntegration).not.toHaveBeenCalled();
  });

  it('read-only viewers get no save button and disabled fields', async () => {
    api.integration.mockResolvedValue({ integration: bot });
    renderWithApp(<IntegrationSection accountId="acc-1" editable={false} />);
    await screen.findByText(/Marked as bot/);
    expect(screen.queryByTestId('integration-save')).toBeNull();
    expect((screen.getByTestId('integration-retention') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('a failed save reports the server error', async () => {
    api.integration.mockResolvedValue({ integration: bot });
    api.setIntegration.mockRejectedValue(new AdminError(403, 'STEP_UP_REQUIRED'));
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    await screen.findByText(/Marked as bot/);
    fireEvent.change(screen.getByTestId('integration-retention'), { target: { value: 'Changed.' } });
    fireEvent.click(screen.getByTestId('integration-save'));
    await confirmReason('r');
    expect(await screen.findByText('This action needs a recent sign-in. Sign in again, then retry.')).toBeTruthy();
  });

  it('a failed load reports the error and renders nothing', async () => {
    api.integration.mockRejectedValue(new AdminError(403, 'FORBIDDEN_ROLE'));
    renderWithApp(<IntegrationSection accountId="acc-1" editable />);
    expect(await screen.findByText('Your admin role does not allow this.')).toBeTruthy();
    expect(screen.queryByTestId('integration-section')).toBeNull();
  });
});
