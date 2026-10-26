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
    const content = (missing: boolean) => (
      <div style={{ display: 'grid', gap: 8 }}>
        <Typography.Text type="secondary">{body}</Typography.Text>
        <Input.TextArea autoFocus rows={3} maxLength={500} placeholder={optional ? 'Reason (optional, recorded in the audit log)' : 'Reason (recorded in the audit log)'} data-testid="reason-input"
          status={missing ? 'error' : undefined} onChange={(e) => { reason = e.target.value; }} />
        {missing && <Typography.Text type="danger" role="alert" data-testid="reason-required">Enter a reason: it is recorded in the audit log.</Typography.Text>}
      </div>
    );
    const dialog = modal.confirm({
      title,
      content: content(false),
      okText,
      okButtonProps: { danger, 'data-testid': 'reason-confirm' } as never,
      // Taking `close` keeps the dialog open until we close it, so a missing reason is explained in place.
      onOk: (close: () => void) => {
        if (!reason.trim() && !optional) { dialog.update({ content: content(true) }); return; }
        resolve(reason.trim());
        close();
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
