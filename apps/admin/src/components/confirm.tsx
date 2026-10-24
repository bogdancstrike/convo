import { App, Input, Typography } from 'antd';

/**
 * Every change asks for a reason, which is written to the audit chain with it. Resolves with the
 * reason, or null when cancelled. With `optional`, an empty reason is accepted and resolves to ''
 * (the server then records a default such as "No reason given").
 */
export function useReason() {
  const { modal } = App.useApp();
  return (title: string, body: string, danger = false, { optional = false, okText = 'Confirm' }: { optional?: boolean; okText?: string } = {}) => new Promise<string | null>((resolve) => {
    let reason = '';
    modal.confirm({
      title,
      content: (
        <div style={{ display: 'grid', gap: 8 }}>
          <Typography.Text type="secondary">{body}</Typography.Text>
          <Input.TextArea autoFocus rows={3} maxLength={500} placeholder={optional ? 'Reason (optional, recorded in the audit log)' : 'Reason (recorded in the audit log)'} data-testid="reason-input"
            onChange={(e) => { reason = e.target.value; }} />
        </div>
      ),
      okText,
      okButtonProps: { danger, 'data-testid': 'reason-confirm' } as never,
      onOk: () => {
        if (!reason.trim() && !optional) return Promise.reject(new Error('A reason is required'));
        resolve(reason.trim());
        return undefined;
      },
      onCancel: () => resolve(null),
    });
  });
}

/** Shows a one-time secret (temporary password) with copy; it is never shown again. */
export function useSecret() {
  const { modal } = App.useApp();
  return (title: string, secret: string, note: string) => modal.success({
    title,
    width: 480,
    content: (
      <div style={{ display: 'grid', gap: 8 }}>
        <Typography.Paragraph copyable={{ text: secret }} code style={{ fontSize: 16, margin: 0 }} data-testid="one-time-secret">{secret}</Typography.Paragraph>
        <Typography.Text type="secondary">{note}</Typography.Text>
      </div>
    ),
  });
}
