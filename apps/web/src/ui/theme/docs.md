# `src/ui/theme` — visual system

* `tokens.ts` — **single source of truth**: brand palette (Deep Navy `#17324D`, Ocean Blue
  `#2596BE`, Soft Cyan `#8BD3E2`, Warm Amber `#F2B66D`, Ice White `#F4F8FA`), derived scales, the
  semantic colour roles for light and dark, avatar grounds, font stacks, and `applyTheme()` which
  writes `--c-*` custom properties on `<html>`.
* `contrast.test.ts` — WCAG contrast checks for every declared text pair (≥ 4.5:1) and UI pair
  (≥ 3:1) in both appearances, plus avatar grounds. Add a pair whenever a new role combination is
  introduced in CSS.
* `app.css` — layout and components using only `--c-*` roles: navigation rail, side panels (chat
  list, new chat, group wizard, settings), conversation with wallpaper and tailed bubbles, info
  drawer, dialogs, responsive breakpoints (≤ 760 px single pane, ≤ 1100 px overlay drawer).

Accessibility rules: Ocean Blue is never used as a text colour on light surfaces (3.4:1) — text uses
`accentText`; solid buttons use `actionFill`/`actionText`; focus is a 2 px ring in the brand colour;
motion respects `prefers-reduced-motion`. Fonts (Inter Variable) are bundled — no external requests.
