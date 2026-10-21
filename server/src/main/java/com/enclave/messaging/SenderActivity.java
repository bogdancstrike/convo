package com.enclave.messaging;

import java.util.UUID;

/**
 * Published inside the storing transaction for every accepted submission (a direct send, or a
 * group application message). It carries only the sending account: no recipients, conversation,
 * size or content. The server cannot tell a message from a receipt, reaction or typing signal —
 * all are encrypted items — so consumers count "encrypted items sent", nothing more.
 *
 * @param accountId sending account
 */
public record SenderActivity(UUID accountId) {}
