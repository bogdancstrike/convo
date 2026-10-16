# Enclave — Sources, provenance, and assumptions

Reviewed on **2026-10-16**. Linked upstream pages describe their own protocols/platforms, not an audit or endorsement of this design. The repository still has no implemented or benchmarked application. Pin exact dependency/toolchain revisions during M0; current documentation is not a substitute for compatibility tests.

## Repository inputs

- Original `specs.md` and `arf.md` drafts supplied in this repository, including their component choices, threat model, API examples, and ADR history.
- All six PNGs in [diagrams](diagrams/README.md), inspected as design inputs. Preserve them as historical references; maintained Mermaid sources describe the revised behavior.
- User requirements: customer-operated on-prem, security first, friendly and feature-rich; backend apps, Android and web first; iOS later; Flutter or Kotlin Multiplatform for mobile.
- [Shared Claude conversation](https://claude.ai/share/48dce41f-b6fa-41cb-bb60-b3d30016964d): the public HTML shell was retrieved, but the conversation snapshot API returned HTTP 403 and the browsing tool could not access the transcript. No transcript contents were available and no decisions are attributed to it. Reconcile it later if its text/export becomes available; this does not block the repository documentation.

## Primary technical references

| Reference | What it supports / what must be verified |
|---|---|
| [libsignal repository](https://github.com/signalapp/libsignal) | License and upstream support/API-change boundary. Browser compilation is an Enclave feasibility task, not a supported browser product inferred from TypeScript bindings. |
| [Signal PQXDH specification](https://signal.org/docs/specifications/pqxdh/) | Asynchronous hybrid session agreement; exact profile and KEM/wire format must come from the pinned integration. |
| [Signal Double Ratchet specification](https://signal.org/docs/specifications/doubleratchet/) | Classical/sparse PQ/Triple Ratchet definitions and integration context; select supported versions explicitly. |
| [Signal ML-KEM Braid specification](https://signal.org/docs/specifications/mlkembraid/) | PQ ratchet building blocks; existence of a specification does not certify every client target. |
| [RFC 9420 — MLS](https://www.rfc-editor.org/rfc/rfc9420.html) | MLS epoch/key lifecycle and delivery/authentication-service responsibilities. Enclave roles, credentials, and recovery need an application profile. |
| [OpenMLS repository](https://github.com/openmls/openmls) | Implementation/features/storage and support scope; custom extensions and browser/native targets require pinned-version validation. |
| [LiveKit encryption documentation](https://docs.livekit.io/transport/encryption/) | SDK encryption capabilities and key-provider responsibility; signaling/API metadata remains visible, and exact SDK behavior must be certified. |
| [KMP supported-platform stability](https://kotlinlang.org/docs/multiplatform/supported-platforms.html) | Current Android/iOS KMP/Compose support; do not repeat outdated platform-maturity claims. |
| [Flutter web FAQ](https://docs.flutter.dev/platform-integration/web/faq) | Web platform differences relevant to the earlier all-Flutter option; UI portability is separate from crypto portability. |
| [Android background task restrictions](https://developer.android.com/develop/background-work/background-tasks/bg-work-restrictions) | OS/OEM/user restrictions affect delivery; deferred work is not guaranteed real-time wake-up. |
| [Apple Local Push Connectivity](https://developer.apple.com/documentation/networkextension/local-push-connectivity) | Later iOS local-network provider/SSID/entitlement model and limits. |
| [Apple PushKit and VoIP handling](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit) | Later iOS incoming VoIP/CallKit obligations; not a general message push bypass. |

## Assumptions to validate

| Assumption | Current treatment | Resolution |
|---|---|---|
| Spring/Java and Rust maintenance capacity | Existing architecture choice; actual staffing not supplied | FND-03 / architecture ownership review |
| Signal + MLS browser/native dependency graph works | Unproven, blocking M0 gate | FND-02 build/cross-decryption evidence |
| Shared Rust protocol logic with separate native/browser storage | Design intent; no existing code | CORE-01/02 |
| Flutter Android is preferable to KMP for this team | Provisional baseline inherited from the draft | FND-02 measured integration decision |
| React web meets accessibility/browser lifecycle needs | Proposed updated UI baseline | WEB-01/02 and UI-01 |
| Large-group/medium-tier sizing and SLOs | Targets, not measured capacity | GRP-03 and OPS-02 |
| Private CA, LAN/VPN, MDM/distributor availability | Customer prerequisites; do not assume all users have them | OPS-01 deployment certification |
| iOS entitlement/signing/local delivery is available | Deferred P1 gate; no Android/web dependency | IOS-01 |
| Product/client distribution license is compatible with dependencies | Unresolved release gate; no internal-use exemption assumed | FND-02 qualified license assessment |

When an assumption fails, update specs, ARF, tasks, UI/mobile behavior, and maintained diagrams together. Keep historical ADR status and provenance visible.
