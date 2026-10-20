# `src/ui/emoji` — emoji catalogue

`emojiData.ts` lazy-loads `emojibase-data/en/data.json` (MIT, bundled — no CDN) as a separate
chunk the first time the picker opens, groups it into picker categories in Unicode order, and keeps
hides emoji versions (≥ 11) whose representative glyph the device's
font cannot draw (canvas colour probe — no boxes/tofu), and keeps a per-browser "Recent" list in `localStorage` (a convenience; failures are ignored). Search matches
the emoji's English label and tags.
