# `ui/calls` — voice and video calls

Media runs through the self-hosted LiveKit SFU; see ADR-0006.

| File | Role |
|---|---|
| `CallProvider.tsx` | One call at a time: outgoing/incoming ringing, accept/decline/hang up, busy replies, ring timeout, teardown. Wraps the signed-in app. |
| `CallScreen.tsx` | Full-window call UI: ring, status/timer, remote tiles, local preview, mute/camera/end, E2EE badge shown only once LiveKit reports encrypted frames. Lazy-loaded. |
| `CallsPanel.tsx` | Device-local call history with call-back buttons. |
| `liveKitCall.ts` | `livekit-client` room with mandatory E2EE (`ExternalE2EEKeyProvider` + E2EE worker). Refuses browsers without frame transforms. |
| `ringer.ts` | Web Audio ring tones (no assets). |
| `errors.ts` | `CallEncryptionUnsupportedError`. |

Signalling and history live in the shared core (`core/calls.ts`, `EnclaveClient.startCall` etc.)
so the Android bridge reuses them.

## Screen sharing

During a connected call, browsers with `getDisplayMedia` show a share button. The shared screen,
window or tab is published as a LiveKit `ScreenShare` track, so frame encryption with the call key
covers it like camera video. Remote shares take over the stage in voice and video calls
("{name} is presenting", letterboxed, camera tiles in a strip). Android shows remote shares the
same way. Sharing from Android (MediaProjection) is a separate step.

