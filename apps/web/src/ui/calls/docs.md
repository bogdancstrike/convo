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
