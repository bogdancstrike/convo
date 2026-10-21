/**
 * Communities (COM-01): an opaque community ID bound to one root announcement MLS group, and
 * scoped links to independent subgroups. Linking needs both a community admin and the subgroup
 * owner; community roles grant nothing inside subgroups. Everything human-readable stays E2EE in
 * the MLS groups; the server mirrors only IDs, link state and versions (observable metadata).
 */
@org.springframework.modulith.ApplicationModule(displayName = "Communities")
package com.enclave.communities;
