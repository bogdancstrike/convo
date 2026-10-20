# ADR-0005: message edit policy anchored to server time

Status: Accepted and implemented (web + Android shared core), 2026-10-20.

## Context

Users may correct their own text: 15 minutes in chats, groups and Note to self, 30 days for
channel posts. Edits show an "edited" label, keep no visible history and never create a new
notification or unread count. Delivery/read state must describe the text that is currently
visible, not an earlier revision. The server never sees plaintext, so it cannot inspect edits.

An earlier plan proposed server-registered edit windows plus salted SHA-256 commitments of the
new text. That adds new tables, a grant protocol and extra round trips for every edit.

## Decision

* The server publishes the policy (`enclave.message-policy.*`, defaults `15m`, `30d`, `5m` grace)
  in `/v1/deployment-info`. It is the only time authority: every envelope already carries a
  server-assigned `serverTimestamp`.
* Receiving clients accept an edit only if
  `editEnvelope.serverTimestamp − original.serverAt ≤ window + grace`, the target is the
  author's own undeleted text/caption (lookups are keyed by author), the text changes, is not
  empty and fits `MAX_BODY_BYTES`, and the edit's `revision` is strictly greater than the stored one.
  Attachments are never replaced by an edit.
* `revision` starts at 1 and increments per edit. Receipts carry the acknowledged revision per
  message ID; senders ignore receipts for older revisions and reset delivery/read state when they edit.
  Recipients acknowledge the new revision on receipt and send a read receipt for it when the chat is
  next opened (`Conversation.revisedUnread`), without raising the unread count.
* The archive merge keeps the newest revision and only merges receipts of equal revisions.
* Senders offer Edit by local clock (`editableUntil`), which the Android bridge also exposes.

## Consequences

* A malicious sender cannot back-date an edit: the server timestamps it on acceptance.
* An edit queued offline that the server accepts after `window + grace` is ignored by recipients
  while the sender's device shows the new text. The grace (max 1 h) bounds this divergence;
  surfacing it to the sender is follow-up work.
* A modified recipient client can still ignore the policy for its own display; E2EE does not let
  the server enforce what a recipient renders.
* Legacy edits without a revision remain ordered by timestamp and cannot override revisioned text.
