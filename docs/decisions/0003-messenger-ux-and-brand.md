# ADR-0003 (implementation): messenger-style UX and brand palette

| Field | Value |
|---|---|
| Status | Accepted (product decision) |
| Date | 2026-10-20 |
| Amends | UI.md §2–3, §5 (visual system and interaction patterns) |

## Context

The product owner wants Enclave to feel immediately familiar — "like WhatsApp, modern, 2026" —
while keeping its own identity, and supplied a brand palette:

| Name | Hex | Role |
|---|---|---|
| Deep Navy | `#17324D` | Brand ink, logo, dark accents |
| Ocean Blue | `#2596BE` | Brand accent, focus, highlights (never body text on light surfaces: 3.4:1) |
| Soft Cyan | `#8BD3E2` | Accent/actions on dark surfaces |
| Warm Amber | `#F2B66D` | Attention: notices, encryption banner, logo dot |
| Ice White | `#F4F8FA` | Light highlights, dark-mode text family |

## Decision

* **Neutral base, palette accents.** Surfaces are neutral greys (light: white/`#F5F6F7`; dark:
  charcoal `#161717`/`#1D1F1F`, as in current messengers). Actions use a darker Ocean
  (`#18657F`, 6.1:1 with white) in light mode and Soft Cyan with near-black text in dark mode;
  outgoing bubbles are a pale cyan tint (light) or deep ocean (dark).
* **Single source of truth:** `apps/web/src/ui/theme/tokens.ts`; components only use `--c-*`
  variables; `contrast.test.ts` enforces WCAG pairs (≥ 4.5:1 text, ≥ 3:1 UI) in both modes.
* **Familiar interaction patterns:** navigation rail; chat list with "Search or start a new chat",
  All/Unread/Groups chips; New chat side panel (New group, Note to self, directory by
  name/handle/phone); two-step group wizard; header subtitle + search + ⋮ menu; hover chevron /
  right-click / long-press message menu with quick reactions; attach menu; searchable emoji
  picker; mic ↔ send composer button; pre-send media preview; right-hand info drawer; home pane
  with quick actions; settings as categories with switches.
* **Delivery ticks** replace status words visually, but every tick carries the UI.md §5.2 wording
  as accessible text and a tooltip; failures still show visible words.
* **Brand mark:** chat bubble + lock, Ice→Cyan→Ocean→Navy gradient with an amber dot
  (`docs/assets/logo.svg`), shown on the splash with "End-to-end encrypted".

## Consequences

* Android (Flutter) must mirror the same tokens and patterns (UI-01 shared design tokens).
* Features not yet implemented (calls, polls, events, contacts) are omitted from menus rather
  than shown disabled — no dead buttons on the P0 path.
