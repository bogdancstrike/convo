# Enclave — UI and interaction specification

| Field | Value |
|---|---|
| Status | Draft v1.3, 2026-10-17 |
| First delivery | Android and web, equal product priority |
| Later | iOS after Android/web stabilization; desktop packaging optional |
| Related | [Specs](specs.md), [ARF](arf.md), [Mobile](mobile.md), [Tasks](tasks.md) |

Every advertised Android/web feature is a launch requirement; optional controls reflect policy or user choice, not release staging. Specs §31 defines verification for each feature.

## 1. Product experience

Enclave should feel like a calm, capable everyday messenger. People can find a colleague, send a file, join a call, and understand whether a message arrived without learning cryptographic terminology. Security is visible when it changes a decision: identity replacement, device linking, browser trust, expired content, guest access, and recording/archive participants. Routine encrypted chats do not show repeated modal warnings.

Android and web implement the same message, identity, group-role, and sync semantics. They use platform-appropriate navigation and controls. Flutter is the Android baseline; React/TypeScript is the web baseline. iOS-specific layouts, CallKit, NSE, and entitlement work are later scope. Design tokens and interaction contracts are shared; widget trees are not.

### 1.1 Experience principles

- Preserve work: offline composition, drafts, attachments, and send status survive process/tab restart when local storage is available.
- Use understandable states: “Waiting for connection”, “Sent”, “Delivered”, and “Read” mean different things.
- Make safe actions easy: identity verification, linking, notification privacy, local lock, and revocation live in predictable places.
- Ask for permissions at the feature that needs them, with a useful fallback after denial.
- Keep conversations central: administration, infrastructure, and protocol internals do not occupy the chat UI.
- Explain limits accurately: expiration requests cannot erase someone else's screenshot; browser content can be exposed by a compromised origin.

## 2. Information architecture

| Area | Android | Web | Contents |
|---|---|---|---|
| Chats | Primary bottom-navigation destination | Primary side-navigation destination | Conversations, pinned section, unread filter, archive, Note to self, new 1v1 chat/group/community and type filters |
| Communities | Bottom-navigation destination | Dedicated sidebar destination | Joined spaces, admin-only announcements, linked discussion groups, membership/manage actions |
| Calls | Bottom-navigation destination | Sidebar destination | Local recent direct calls; start audio/video; direct/group call entry, screen sharing and member call links |
| People | Search/new-chat entry; optional destination on wide layouts | Directory panel/new-chat flow | Org handles, local contacts, guests, blocked accounts; no phonebook import |
| Settings | Avatar/menu entry | Sidebar/footer entry | Profile, appearance, notifications, privacy, devices, storage, connectivity/help |
| Administration | Separate authorized web origin | Separate app | Users/guests/devices, policy, health, audit; no chat-content browser |

Directory search matches permitted organization handles. Display name/avatar is decrypted only where the viewer has the profile key; otherwise show the handle and an initial-based fallback. Never imply an encrypted display name is server-searchable.

### 2.1 Responsive layouts

| Width | Layout | Behavior |
|---|---|---|
| < 600 CSS px / compact Android | One pane | Chat list → conversation → details; Back preserves scroll/draft and closes transient controls first. |
| 600–1023 CSS px / medium Android | Two panes when usable | Conversation list ~300 px plus active thread; details use a sheet/dialog. |
| ≥ 1024 CSS px / expanded Android | Two panes plus optional details | List 320–360 px, thread flexes, details ~320 px; never compress composer below usable width. |

Use CSS pixels for browser and density-independent units on Android; breakpoints describe available layout width, not device names. Composer stays visible above the keyboard; safe insets, split-screen, rotation, zoom, and display scaling must not obscure controls. A narrow web window remains a supported chat UI.

### 2.2 Main web layout

```text
┌──────────────┬────────────────────┬─────────────────────────────┐
│ Chats / Calls│ Search chats       │ Ana Popescu        Call  ⋯  │
│              │ Pinned             ├─────────────────────────────┤
│              │ Incident response  │ Today                       │
│              │ Ana Popescu        │  Message bubbles            │
│              │ Design team        │  Reply/file/voice note      │
│              │                    │  Waiting for connection     │
│              │                    ├─────────────────────────────┤
│ Settings     │ New chat           │ Attach  Write a message Send│
└──────────────┴────────────────────┴─────────────────────────────┘
```

Security and connectivity notices belong near the thread/header they affect. Persistent notices must not cover the conversation or steal focus on each reconnect.

## 3. Visual system

Use a warm neutral surface, deep teal primary actions, readable typography, and restrained motion. Avoid visual noise behind message text. These are starting tokens to verify against actual rendered contrast, not a claim that every possible pair meets accessibility requirements.

| Semantic token | Light | Dark | Use |
|---|---|---|---|
| `surface.canvas` | `#F6F8F7` | `#101918` | Application background |
| `surface.panel` | `#FFFFFF` | `#182422` | Lists, composer, dialogs |
| `text.primary` | `#162622` | `#ECF3F0` | Body and headings |
| `text.secondary` | `#4F625B` | `#B1C3BB` | Metadata and helper text |
| `action.primary` | `#086B58` | `#78D9BD` | Primary action; use tested contrasting text |
| `message.outgoing` | `#DDF3E9` | `#214A3D` | Own message background |
| `message.incoming` | `#FFFFFF` | `#22302C` | Other message background |
| `state.danger` | `#B42318` | `#FFB4AB` | Destructive/error state plus label/icon |
| `focus.ring` | `#185ADB` | `#A6C8FF` | Keyboard focus, independently visible from selection |

System fonts are the baseline; optional Inter/Noto fonts must be bundled and served on-prem. Body text is 16 px on web and scales with Android font settings. Metadata is at least 12 px; never hide delivery meaning in tiny timestamp icons. Use a 4/8 px spacing scale, 12–16 px message radius, 8–12 px control radius, and low-elevation panels. Android touch targets ≥ 48 dp; web actionable targets ≥ 44 CSS px where possible and at least WCAG minimum sizing/spacing.

Motion normally lasts 120–200 ms and respects reduced-motion/system animation settings. Sending progress uses calm inline feedback; errors never shake the whole screen. Avatars have accessible names, stable fallback colors, and status conveyed with text where needed.

## 4. Onboarding, identity, and devices

### 4.0 Account authentication choices

Organization sign-in offers the trusted Keycloak passwordless/passkey path and approved password/SSO alternatives. Security → Account authentication opens trusted Keycloak actions for named passkeys, Enable authenticator 2FA (Google Authenticator-compatible), recovery codes and credential removal. Show whether 2FA is user-enabled or organization-required; never imply successful SSO grants chat-history access. A user-enabled TOTP factor must apply to both password and passwordless paths unless a disclosed certified organization policy permits another MFA method. Cancellation, unsupported authenticators, incorrect/expired codes, lost factors, IdP outage and enforced settings have actionable states. QR/OTP secrets stay on Keycloak pages. Reauthentication for sensitive changes is distinct from local app unlock. See specs §4.1.1 and AC-ID-01–05.


### 4.1 Organization entry and first registration

1. Welcome screen: “Private messaging for your organization.” Primary action: “Connect to your organization.” Support manual HTTPS URL and authenticated managed configuration; Android may scan an organization QR.
2. Confirm organization name/domain and connectivity profile. A QR may identify an endpoint but cannot silently replace a trusted CA/root. Certificate failures explain how to contact IT; there is no bypass button.
3. “Sign in with your organization” opens the system browser on Android and the approved OIDC flow on web. Do not embed an IdP password form in the chat app.
4. If this is the first device, Android or web can register locally generated identity material after SSO. Web first registration requires browser-trust acknowledgement and certified encrypted persistence; no Android phone is required. Show progress with safe cancellation/retry; no blank spinner after network failure.
5. Name the device, explain generic notifications, and offer app/browser lock setup. Notification permission is requested after the user understands its purpose.
6. Land in a useful empty state: “Start a private conversation” with People and Note to self actions.

A failed/expired SSO flow keeps the organization choice and resumes safely. Repeated taps cannot create multiple primary devices.

### 4.2 Browser linking and additional Android devices

An existing-account sign-in offers “Link from a trusted device” and, behind a deliberate secondary path, “I no longer have a trusted device”. Web shows a single-use QR, organization domain, browser/device name, and expiry. Android scanner confirms the browser/session details before sending account keys over the authenticated provisioning channel. An existing browser can approve another device by scan or a manual challenge with a transcript fingerprint comparison on both devices; it must not trust an unverified link pasted into navigation.

Use explicit approval copy: “Link Firefox on Linux to your account? It can receive future messages.” Offer explicit optional bounded encrypted history transfer from a trusted source device. Default copy is off; explain the date range, expiry and “Copying history” state. If no source/backup is available, explain that earlier messages cannot be recovered merely by signing in. Expired/cancelled QR sessions show a fresh-code action. QR and connection details must not appear in analytics, logs, or screenshots created for diagnostics.

The Devices page lists current device first, platform, decrypted user label, linked date, and coarse activity. “Unlink” states that future access stops and local deletion is attempted when the device contacts the service. The user can review a persistent own-device security notice after an unexpected link. Organization reset is distinct from ordinary sign-out.

### 4.3 Verification and identity change

Conversation details expose “Verify identity”: numeric safety number, QR, verified/unverified explanation, and last verification context. Do not equate directory/SSO approval with out-of-band identity verification.

For a verified contact whose IK changes, keep the draft and block sending with “Ana's security identity changed. Verify with Ana before sending.” Actions: “Review identity”, “Keep draft”, and a deliberate re-verification flow. For an unverified contact, show a persistent identity-change notice and require the configured acknowledgement. Never relabel a replaced identity as verified automatically.

## 5. Chat, composer, and groups

### 5.1 Conversation list

Each row has avatar, local name/handle, last allowed preview, timestamp, unread count, mute/pin/guest indicator, and outgoing failure where relevant. Sort by latest local activity with stable tie-breaking; pinned conversations remain in their own section. Hidden/locked previews become “New message”. Swipe actions on Android also exist in a menu for accessibility. Archive, mute, delete locally, and block have distinct consequences.

### 5.2 Message presentation and delivery

| Core state | Visible wording | Accessible meaning |
|---|---|---|
| `queued` / offline | “Waiting for connection” | Encrypted/local outbox has not been accepted by the server. |
| `submitting` | “Sending” | Submission underway; uncertain outcome may require idempotent retry. |
| `accepted` | “Sent” | Service durably accepted the encrypted envelope. |
| Recipient receipt | “Delivered” | A recipient device decrypted/persisted and emitted a delivery receipt. |
| Read receipt | “Read” | Recipient opted to report reading; never inferred from presence. |
| Identity/membership block | “Action needed” plus reason | Sending pauses with draft/ciphertext safely retained. |
| Permanent failure | “Could not send” + Retry/Details | User can retry or remove the local item without duplicating a prior success. |

Aggregate multi-device state per recipient account, not as five separate checkmarks. In groups, show bounded receipt details only where enabled. Display a stable date/time order while preserving authoritative protocol event order internally. Long text, emoji, RTL text, mixed scripts, URLs, code blocks, and attachments must not overflow bubbles.

Reply shows an accessible source link/placeholder. Edited messages expose edit history only if policy permits retaining it. Deleted/expired content has a clear tombstone; expiring previews and local notifications are cleaned up too. Unknown content becomes “Update needed to view this item”, never an unhandled exception or raw protobuf.

### 5.3 Composer and attachment flow

Safe basic text formatting (bold/italic/code/quotes) is P0, using typed content without raw HTML. Web Enter sends, Shift+Enter inserts a newline; users can choose Enter-for-newline. IME composition Enter never accidentally sends. Android follows native keyboard behavior with a distinct Send action.

Attach opens local file/photo selection; the upload sheet shows selected files, sizes, progress, cancel/retry, and policy limits before send. Images strip location EXIF by default, with a clear permitted opt-out if policy allows. Voice-note recording has start/pause/cancel/send and accessible elapsed time; microphone permission is requested on first recording action. Leaving a draft never starts an upload or microphone recording silently.

Drag/drop and paste work in web with type/size validation and a preview. Confirm before pasting a large file batch. Opening a file or external URL is an explicit action with destination visible. Failed downloads distinguish expired, missing, offline, integrity failure, and insufficient storage.

### 5.4 Group management

Create group: choose people, set encrypted name/avatar, review participants/devices, create. The creator is owner. Details show member accounts, roles, devices where security-relevant, guest expiry, disappearing timer, and verification context. Adding/removing members shows progress until the secure membership change is accepted; a server ACL update alone never marks it complete.

If a revoked device requires removal, show “Updating this group's security” and preserve unsent text. If catch-up/rejoin fails, explain “This device needs to rejoin the secure group”; do not ask users to bypass security checks. Ownership transfer is explicit; leaving as final owner requires transfer or group deletion. Announcement mode shows nonposting members a clear read-only composer state.

### 5.4a Group roles and community management

Group details provide named “Add members”, “Remove from group”, “Make group admin”, “Remove admin role”, “Transfer ownership”, “Invite link”, “Join requests”, “Posting permissions”, and “Pinned messages” actions. Hide or explain unauthorized actions according to specs §30.2. Admins can promote ordinary members under default policy; only the owner demotes/removes peer admins. A promotion confirmation summarizes granted powers; ownership transfer requires acceptance by the new owner. Never use an unlabeled generic role toggle for destructive privilege changes.

Communities is a first-class Android/web destination. A community page has **Announcements**, **Groups**, **About/rules**, and role-appropriate **Manage** views. Ordinary members see the announcement feed with “Only community admins can post”; there is no enabled composer for new posts/comments. Allowed reactions appear only when community policy enables them. Admins see a Publish action and the same protected role/ownership operations. Optional launch replies link to a discussion group with explicit membership.

Groups within a community show joined, available-to-request, pending approval, and restricted states; unauthorized private groups are not listed. Any limited private-link label shown to a linkage manager is explicitly shared by the subgroup owner and does not grant message/roster access. Community admin status does not imply subgroup membership or access. Linking an existing group requires community/admin and subgroup-owner approvals plus affected users' community-enrollment consent; show whose membership/visibility changes before applying it.

Removal dialogs explain whether the operation affects the root announcements, selected subgroup, or all linked subgroups. Display per-space pending secure-removal progress and retry/recovery without claiming completion while a subgroup lacks a valid removal commit. Block final-owner leave with a transfer/delete action. Revoking an invite/ban is distinct from deleting history or muting.

Shared pinned messages appear in the thread/header and are governed by group permissions. Private bookmarks and conversation pins stay in the user's own organization controls. “Removed by a group admin” identifies a moderation action; administrators cannot edit another author's words. A pin unavailable on this device shows a placeholder; joining a space does not automatically copy old pinned content.

Forwarding opens a destination picker, identifies the selected content/new audience, and respects the target's posting rights. Preserve a Forwarded label without leaking the source group/community identity by default. Offer View once, Schedule, Topics, Events and Polls at launch when policy permits; disabled controls explain a real permission/profile limit, never missing feature implementation.

### 5.4b Announcement acknowledgements and welcome flow

Community admins have an optional “Request acknowledgement” switch when composing an announcement. Before publishing, show the eligible audience, optional due time, expiry, and named reviewers (default publishing admin + owner, maximum 10). Members see an “I acknowledge this announcement” action and who receives the response; the feed remains read-only for member posts. Use “Pending sync”, “Acknowledgement sent”, “Late”, “Withdrawn”, and “Updated—please acknowledge again” states. Never label automatic read/delivery as an acknowledgement. Reviewer-only details/counts are private to the authorized recipients, with export off by default.

After approved community enrollment, open a welcome overview with purpose/description, current rules, recommended eligible groups, help, and a newcomer checklist. Provide “Continue later” and an easy way to return from About/rules. Label optional versus required guidance; rules acknowledgement explicitly names the version and reviewers. Checklist completion stays private to the member's devices; the UI must not imply the admin sees it. Updated rules have a visible review banner; an acknowledged prior version cannot silently count as the new one.

Recommendations show Joined, Request to join, or Pending approval only when the user may discover that subgroup. Selecting a recommendation follows normal membership approval; it never auto-joins or grants historical content. Completed onboarding is not proof of authorization or a legal agreement. Test keyboard/TalkBack/screen-reader access, offline continuation, two-device progress, deleted/expired acknowledgement requests, and changed rules/checklist items on Android and web. See specs §30.6–30.7.

### 5.4c Conversation appearance, discovery, and quick actions

About pages present rich group/community descriptions (purpose, safe links, contact people and rules references) with an authorized Edit action and readable plain-text fallback. Member search provides All/Admins filters and account-level counts. Contact details show Groups in common from authorized active local memberships; stale offline results are labeled and inaccessible private/left/deleted/inactive groups are excluded. An authorized mutual private group remains eligible; private conversation archiving alone does not change membership. Personal Chat appearance offers colors, bundled/custom wallpapers, preview and Reset; changes affect only the user's devices and preserve accessible contrast.

Photo albums appear as an ordered grid with album/per-photo captions, count, upload progress and a full-screen next/previous viewer. Partial upload failure stays in the composer until retry or explicit removal of failed photos; an expired downloaded photo keeps an unavailable slot. An album is one logical selectable message.

Conversation navigation includes First unread, Latest, and Return to previous position. Keep the viewport steady as new messages arrive above/below the reader; preserve an available anchor across restart and explain missing/expired anchors. Android swipe-to-reply and long-press actions have labeled alternatives. Web hover controls also appear on focus, with keyboard/context-menu access; IME/text selection/dialogs cannot accidentally trigger Send or Delete.

Multi-select has an action bar with selected count, Copy, Forward, Save and eligible Delete actions. Show unavailable-item counts, explicit destinations, destructive confirmation and per-item pending/failure outcomes; never imply all selected messages share the same author/permissions or an atomic result. Read-only community feeds still permit eligible personal actions while preserving posting restrictions. See specs §30.8.

### 5.5 Search and organization

Search scopes: current conversation, all local chats, people, files. Separate “People in your organization” (directory request) from “Messages on this device” (local search). Filters include sender, date, file type, and conversation. Search keeps Romanian diacritics usable and highlights locally. An empty result explains that history from before this device was linked may be absent.

Pin/save/archive/mute remain private account preferences. A saved message still follows expiration policy. Clearing local data has a confirmation naming this device and explains recovery limits; it does not imply remote deletion for all recipients.

## 6. Direct and group calls at launch

P0 direct audio/video entry points appear in the conversation header and Calls page. Pre-call UI shows microphone/camera choice, selected device, and permissions. Incoming call UI has caller identity after authenticated local decryption, Accept, Decline, and “Answered on another device” handling. Android uses native Telecom integration; browser incoming calls depend on an active permitted browser session.

During a call show mute, camera, audio route, connection/reconnecting state, duration, and a clearly labeled End call. Keyboard shortcuts must not fire while typing in another control. Camera is off until explicitly enabled; never auto-answer during simultaneous dialing. “Always relay calls” explains privacy/bandwidth implications; it is on for guests/external contacts by default.

Launch includes group grid/active speaker, participant list, raise hand, screen sharing, authenticated member call links and P2P escalation. E2EE failure stops media and shows “Could not establish a secure call”; never offer an insecure retry mode. Visible recording/archive participants produce a persistent banner before media/content is shared.

## 7. Privacy, notifications, and settings

| Setting | P0 default | Explanation |
|---|---|---|
| Notification preview | Generic “New message” | User choice cannot exceed organization policy; locked clients may remain generic. |
| Read receipts / typing | Off / off | Changes sync privately to own devices; no inferred read state. |
| App/browser lock | Enabled, 5 min inactivity | Android OS-keystore/biometric support; browser portable passphrase baseline. |
| Disappearing timer | 7 days in hardened profile | Organization may choose another policy; unopened maximum retention shown separately. |
| Link previews | Off | Enabling may contact the linked site from this device. |
| Guest/external calls | Relay on | Reduces peer IP exposure, with possible quality/bandwidth cost. |
| Telemetry | Off | Optional sanitized on-prem diagnostics with explicit preview/consent. |

Settings display organization-managed controls with a short reason and help link. Never render a disabled control without explanation. Device storage shows encrypted local size, attachment cache cleanup, expiry rules, and export availability. Export is an explicit plaintext-sharing action if enabled; destinations and policy restrictions are visible.

Connectivity diagnostics show the organization host, LAN/VPN availability, notification capability, and last successful contact. They do not show raw tokens, keys, message bodies, or a live employee-activity log. Diagnostic export previews a sanitized report before saving/sharing.

### 7.1 Mentions-only mode and timed snoozing

Per-conversation notifications offer All messages, Mentions only, and Muted, plus a separate Snooze action. Explain that mention verification happens locally after permitted decryption; a locked client may defer alerts. Generic push delivery is not proof of a mention. Show Snooze until this evening/tomorrow/duration/custom time with the exact date/time/zone and an End snooze now action. State the underlying mode that will resume, including an already Muted conversation. Snoozing does not hide incoming content/unread counts or change separate call/security settings. Resume quietly without replaying every suppressed alert; show expired snooze correctly after app/browser restart or a time-zone change.

## 8. Web-specific interaction and trust

The web client is a complete P0 UI, not a placeholder for the Android app. It supports responsive chats, files/voice notes, local search, identity verification, groups, device settings, and direct calls wherever the certified browser capability permits.

At first link and in Security settings show: “This browser runs code from your organization's chat server. A compromised server or browser can access messages in this session.” Keep a concise “Browser session” trust indicator with expandable detail; ordinary usage must not repeatedly interrupt users. Native apps can be suggested in the detail without blocking an allowed web session.

Cross-tab behavior is explicit: one worker/storage owner processes protocol state; other tabs subscribe through fenced coordination. If a supported browser cannot coordinate safely, a second tab shows “Chat is open in another tab” with a safe switch action. Do not create a new device for each tab or run concurrent independent ratchets.

Storage eviction/private browsing has a visible reduced-persistence state. Cleared storage requires re-linking and never masquerades as an empty restored history. Offline cached assets must not contain decrypted messages. Sensitive data stays out of URLs, browser history, HTTP caches, and title previews when locked. Signing out clears this browser's keys/storage and revokes the device where reachable, with an offline pending-revocation explanation.

Restricted/air-gapped web shows “Notifications arrive while this browser session is active.” Connected Web Push is a separate organization/user opt-in, never assumed to work through local infrastructure alone. Browser certificate trust is managed through the browser/OS, not an in-app pinning toggle.

## 9. Accessibility and localization acceptance

Web targets WCAG 2.2 AA. Test keyboard-only completion of onboarding, new chat, send/reply/react, attachment, verification, settings, and call acceptance/end. Use semantic landmarks, labeled buttons, visible focus, skip navigation, sensible tab order, and modal focus restore. Incoming messages use a batched polite live region; do not read whole histories or steal focus as messages arrive.

Android tests cover TalkBack, Switch Access, large font/display scaling, landscape, one-handed reach, and external keyboard. Screen readers announce sender, content type, reply context, timestamp, and delivery state in a predictable order. Icon-only controls need action labels, and security/delivery indicators require more than color. Call controls remain reachable at 200% browser zoom and largest supported Android text settings.

Use English and Romanian message catalogs in P0, including plural forms, diacritics, localized dates/numbers, and 12/24-hour preferences. Prepare layout for RTL and longer translations without claiming full locale certification. Never concatenate translatable sentence fragments. Relative-time labels expose exact timestamps accessibly.

## 10. Empty, degraded, and recovery states

| Trigger | User outcome | Recovery action |
|---|---|---|
| No conversations | Useful welcome with People / Note to self | Start chat; no dummy personal data. |
| No network / VPN missing | Persistent connection state, preserved local history/draft | Retry automatically with backoff; actionable VPN/host guidance. |
| Push blocked | Show actual notification capability | Android settings/distributor guidance; web active-session explanation. |
| Account disabled / device revoked | Signed-out/revoked state, local key cleanup | Contact organization admin; no endless retry. |
| Verified identity changes | Draft kept, sending blocked | Review and re-verify. |
| Key/MLS state unavailable | Conversation remains readable where old local history exists | Secure catch-up/rejoin; never discard all history as first response. |
| Attachment integrity fails | File never opens; report “File could not be verified” | Retry ciphertext download, then sanitized support detail. |
| Policy/update requires newer client | Actionable update-required state | On-prem signed update link or managed-distribution instructions. |
| Local disk/browser storage full | Stop promising durable send/save | Free cache/storage; retain recoverable drafts where possible. |

## 11. Administration UI

The admin app uses a separate host and stronger auth/session policy. Navigation: Overview, People/Guests, Devices, Policies, Audit, Operations. Overview shows aggregate availability/queue/key-health; no private chat previews. User support shows account status, device count, and coarse activity only. Sensitive actions require a reason, affected-device summary, and a deliberate confirmation; step-up auth is requested when required.

Policy editing shows current version, changed fields, client-visible effects, and conflict handling. Audit search/export has bounded ranges and an accountable export record. Health panels explain provider acceptance versus device delivery. No screen implies administrators can restore E2EE history or erase an offline device with certainty.

## 12. UI completion evidence

Produce Android and web flows from shared scenario fixtures, not screenshots alone. Capture compact/wide and light/dark states, keyboard/TalkBack/screen-reader recordings, first-use trials, offline/restart scenarios, and security-change decisions. Use golden/component checks only for durable layout contracts; avoid brittle pixel snapshots of every message variant. [tasks.md](tasks.md) maps this work to UI-01, AND-01/02, WEB-01/02, and REL-01.


## 12. Complete launch feature journeys and evidence

All capabilities in specs §30.9 are present in Android/web launch UI. Topics/folders, quiet/scheduled send/reminders, polls/quizzes/events/RSVP, view-once, local transcription/assistance, history transfer/recovery backup, visible integrations and federation have creation/enrollment, normal use, permission-denied, offline, cancel/edit/delete/expiry and recovery states. Security settings expose sealed transport mode, witnessed verification and applicable reviewed PQ group capabilities without claiming stronger security than the certified profile. External deployments and plaintext-receiving integration audiences are clearly labeled before sharing.

Scheduled send names the executing device and explains next-allowed execution offline. Backup setup requires saving the distinct client recovery key; account recovery cannot replace it. Assistance previews selected sources and editable results, never auto-sends or invokes tools. Polls disclose visible ballots; topic screens do not imply a private audience. Every enabled optional feature has real functionality; opt-in/default-off status is a privacy preference, not a deferred feature.

Specs §31 supplies test scripts, methods and pass/fail criteria for all journeys. UI-01/AND-02/WEB-02/03 supply accessible interactive fixtures and real-client evidence; catalogue coverage is required before launch.
