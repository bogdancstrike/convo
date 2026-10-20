# ADR-0002 (implementation): search people by name and phone via the organization directory

| Field | Value |
|---|---|
| Status | Accepted (product decision) |
| Date | 2026-10-20 |
| Amends | specs §12.1 `GET /directory/search` (handle-only), UI.md §2 directory note |

## Context

The specification keeps the server directory handle-only because display names live in end-to-end
encrypted profiles. Product direction is a WhatsApp-like experience: people must be findable by
**name** and by the **phone number associated with their account**.

## Decision

* Directory attributes come from the **organization IdP**, not from E2EE profiles: the `name` and
  `phone_number` claims (configurable: `enclave.identity.display-name-claim` / `phone-claim`).
  They are refreshed whenever the user presents a Keycloak token (enrollment, linking).
* The server stores `display_name`, `phone`, a diacritic-folded `search_text` and `phone_digits`,
  with trigram indexes. Search matches handle prefix, name word-prefix (so "stefan" finds
  "Ștefan Ionescu") or phone digits (≥ `min-phone-digits`, default 4, to limit enumeration).
* Results include display name and phone; they are organization directory data that the IdP
  already exposes to members of the organization. Message content, E2EE profiles, contact lists
  and conversation graphs remain unavailable to the server.
* No phone-book upload: users type a name or number; nothing is matched in bulk.

## Consequences

* Organizations must decide which IdP attributes are directory-visible (Keycloak user-profile
  permissions control `phoneNumber`; the development realm makes it admin-managed, user-viewable).
* Directory freshness depends on users signing in; the IdP reconciliation adapter (§27, ID-02) should
  also refresh these attributes.
* Rate limiting of directory search is required before launch (SEC-01 enumeration review).
