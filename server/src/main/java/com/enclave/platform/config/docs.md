# `platform.config`

Infrastructure beans that every module may inject by type:

* `Clock` (UTC) — the single time source for expiry checks done in Java, replaceable in tests.

Keep this package free of business configuration; module settings belong to typed
`@ConfigurationProperties` records inside the owning module.
