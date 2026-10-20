# `src/ui/i18n` — localization

* `en.ts` — English catalog; its keys define `MessageKey`.
* `ro.ts` — Romanian catalog typed as `Record<MessageKey, string>`, so a missing translation is a
  compile error.
* `i18n.tsx` — `I18nProvider` / `useI18n()` with `{name}` interpolation and `Intl` date/time
  formatting.

Add a language by adding a catalog file and registering it in `catalogs`. Keep strings complete
sentences (no concatenation) so translations can reorder words; layouts must tolerate ~40%
longer text (UI.md §9).
