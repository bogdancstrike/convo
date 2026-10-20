# `src/ui/components` — reusable presentational components

| Component | Purpose |
|---|---|
| `Icon` | Bundled inline SVG icons; decorative unless `label` is given |
| `Avatar` | Initial-based avatar with a stable per-account color |
| `FormattedText` | Safe `*bold*` / `_italic_` / `` `code` `` / `> quote` rendering without HTML injection |
| `AttachmentView` | Encrypted photo (auto-decrypt) / file (explicit Download) rendering with expired/offline/integrity errors; in-memory object URLs only |
| `PeoplePicker` | Directory search with multi-select chips |
| `Dialog` | Native `<dialog>` modal with Escape/backdrop close and browser focus management |

Components are stateless and know nothing about the protocol client.
