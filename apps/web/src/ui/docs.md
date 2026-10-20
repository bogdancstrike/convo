# `src/ui` — React user interface

* `App.tsx` — top-level state machine (loading → welcome → enrolling → ready, plus other-tab,
  revoked, update-required and unreachable states) and leader-lock handling.
* `hooks.ts` — React bindings for `EnclaveClient` events.
* `screens/`, `components/`, `theme/`, `i18n/` — see their `docs.md`.

Accessibility baseline: semantic landmarks, labelled controls, visible focus, `role="log"` for
messages, `aria-live` for typing/status, ≥ 44 px targets, keyboard-reachable message actions
(they appear on hover *and* focus).
