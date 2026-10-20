# `src/ui/theme` — visual system

* `tokens.css` — semantic tokens from UI.md §3 (surfaces, text, action, message, danger, focus),
  spacing/radius/target sizes and motion. Dark values apply via `prefers-color-scheme` unless the
  user picked a theme (`<html data-theme>`). `prefers-reduced-motion` zeroes motion.
* `app.css` — layout (rail / list / thread), components and responsive breakpoints
  (< 600 px single pane, 600–1023 px compact two-pane, ≥ 1024 px wide).

Rules: components use tokens only; touch targets ≥ 44 CSS px; focus is always visible and
distinct from selection; no external fonts or assets (air-gapped deployments).
