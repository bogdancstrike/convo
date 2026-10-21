package com.enclave.calls.internal;

import com.enclave.groups.GroupMembersRemoved;
import java.time.Clock;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.modulith.events.ApplicationModuleListener;
import org.springframework.stereotype.Component;

/**
 * Removes accounts that stopped being group members from the group's ongoing calls. Their join
 * tokens are already refused; this also drops a live connection. The remaining participants then
 * rotate the media key through the MLS group (clients, ADR-0006), which the removed account no
 * longer receives.
 */
@Component
class CallMembershipListener {
    private static final Logger log = LoggerFactory.getLogger(CallMembershipListener.class);
    private final CallRepository calls;
    private final LiveKitRooms rooms;
    private final CallsProperties properties;
    private final Clock clock;

    CallMembershipListener(CallRepository calls, LiveKitRooms rooms, CallsProperties properties, Clock clock) {
        this.calls = calls;
        this.rooms = rooms;
        this.properties = properties;
        this.clock = clock;
    }

    /** Persistent (Modulith registry): retried if LiveKit is briefly unreachable. */
    @ApplicationModuleListener
    void on(GroupMembersRemoved event) throws Exception {
        if (!rooms.enabled()) return;
        for (var call : calls.openGroupCalls(event.groupId(), clock.instant().minus(properties.maxCallAge()))) {
            for (String identity : rooms.participants(call.room())) {
                if (removed(identity, event)) {
                    rooms.remove(call.room(), identity);
                    log.info("Removed a former group member's device from an ongoing call");
                }
            }
        }
    }

    /** Identities are {@code accountId:deviceId} (issued by {@link CallService}). */
    static boolean removed(String identity, GroupMembersRemoved event) {
        int colon = identity.indexOf(':');
        if (colon < 0) return false;
        try {
            return event.accounts().contains(UUID.fromString(identity.substring(0, colon)));
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
