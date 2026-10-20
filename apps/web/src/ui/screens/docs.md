# `src/ui/screens` — application screens

| Screen | UI.md section | Notes |
|---|---|---|
| `StatusScreens.tsx` | §4.1, §10 | Loading, welcome (browser-trust acknowledgement + SSO), enrolling/failed, account-has-devices, other-tab, revoked, storage-lost (re-setup), update-required, unreachable |
| `LinkDeviceScreen.tsx` | §4.2 | New-device linking: comparison code, approval wait, expiry/decline/new code |
| `MainLayout.tsx` | §2.2 | Navigation rail + list + thread/settings; single-pane below 600 px |
| `ChatList.tsx` | §5.1 | Search with diacritic folding, pinned section, archive toggle, unread badges, drafts |
| `Thread.tsx` | §5.2–5.3 | Messages with day separators, delivery states, reply/react/edit/delete/copy, identity-change notice, composer with IME-safe Enter, persisted drafts, typing, attachments (picker, drag & drop, paste, size checks, upload progress) |
| `NewChatDialog.tsx` | §2 | Directory search by handle |
| `NewGroupDialog.tsx` | §5.4 | Group name (E2EE) + member picker |
| `GroupInfoDialog.tsx` | §5.4a | Members with owner/admin labels, admin add/remove, concurrency (busy) feedback |
| `SafetyNumberDialog.tsx` | §4.3 | 60-digit safety number, mark verified/clear |
| `Settings.tsx` | §7, §4.2 | Handle, theme, language, receipts/typing (off by default), link requests (compare code → approve/decline), devices/unlink, sign-out + wipe |

Screens talk to the protocol only through `EnclaveClient` (`src/core/client.ts`) and the hooks in
`src/ui/hooks.ts`.

`ChatListPanel.tsx` searches local messages and titles and shares `conversationMenu.ts` actions with the thread. `SharedContent.tsx` provides routed media/link/document tabs. `ProfileSettings.tsx` edits photo/status and configures recovery; `RecoveryScreen.tsx` restores lost-device access. Settings navigation stays in the sidebar on wide screens; controls use the main workspace. Channels reuse the group wizard with a backend-enforced admin-only posting mode.
