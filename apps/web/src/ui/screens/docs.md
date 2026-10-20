# `src/ui/screens` — application screens

| Screen | UI.md section | Notes |
|---|---|---|
| `StatusScreens.tsx` | §4.1, §10 | Loading, welcome (browser-trust acknowledgement + SSO), enrolling/failed, account-has-devices, other-tab, revoked, storage-lost (re-setup), update-required, unreachable |
| `LinkDeviceScreen.tsx` | §4.2 | New-device linking: comparison code, approval wait, expiry/decline/new code |
| `MainLayout.tsx` | §2.2 | Navigation rail + list + thread/settings; single-pane below 600 px |
| `ChatList.tsx` | §5.1 | Search with diacritic folding, pinned section, archive toggle, unread badges, drafts |
| `Thread.tsx` | §5.2–5.3 | Messages with day separators, delivery states, reply/react/edit/delete/copy, identity-change notice, composer with IME-safe Enter, persisted drafts, typing |
| `NewChatDialog.tsx` | §2 | Directory search by handle |
| `SafetyNumberDialog.tsx` | §4.3 | 60-digit safety number, mark verified/clear |
| `Settings.tsx` | §7, §4.2 | Handle, theme, language, receipts/typing (off by default), link requests (compare code → approve/decline), devices/unlink, sign-out + wipe |

Screens talk to the protocol only through `EnclaveClient` (`src/core/client.ts`) and the hooks in
`src/ui/hooks.ts`.
