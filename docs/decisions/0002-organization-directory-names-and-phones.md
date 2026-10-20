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

### 2026-10-20 update: required phone and Android address-book discovery

Phone is now required and editable in Keycloak's user profile. Verify Profile is enabled;
seed accounts missing a number must complete Update Profile on sign-in. The application still
receives the phone claim from Keycloak, rather than accepting unsigned client profile fields.
A self-entered number is not proof of ownership; the present development realm does not perform
SMS verification. Safety numbers and authenticated account identity remain authoritative.

The user has now requested permission-based native address-book discovery. Android will read
phone numbers only after explicit OS permission, normalize on device and match exact full
numbers in bounded requests to the organization's directory. Contact names and address-book
photos stay on the device. Denial must leave manual directory lookup usable. This supersedes
the earlier no-bulk-matching UI scope, but does not authorize collecting address books or treating
an unverified phone claim as proof of identity.
