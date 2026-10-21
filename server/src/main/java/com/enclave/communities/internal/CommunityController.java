package com.enclave.communities.internal;

import static com.enclave.contracts.Base64Url.decode;

import com.enclave.identity.AuthenticatedDevice;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

/** Community endpoints (specs §12.4a), device-authenticated. Group IDs are base64url. */
@RestController
class CommunityController {
    record CreateRequest(String rootGroupId) {}
    record LinkRequest(String groupId, String visibility) {}

    private final CommunityService communities;
    CommunityController(CommunityService communities) { this.communities = communities; }

    @PostMapping("/v1/communities")
    @ResponseStatus(HttpStatus.CREATED)
    CommunityService.CommunityView create(@AuthenticationPrincipal AuthenticatedDevice me, @RequestBody CreateRequest body) {
        return communities.create(me.accountId(), decode(body.rootGroupId(), "rootGroupId"));
    }

    @GetMapping("/v1/communities/mine")
    List<CommunityService.CommunityView> mine(@AuthenticationPrincipal AuthenticatedDevice me) {
        return communities.mine(me.accountId());
    }

    @GetMapping("/v1/communities/{communityId}/groups")
    List<CommunityService.LinkView> groups(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID communityId) {
        return communities.groups(me.accountId(), communityId);
    }

    @PostMapping("/v1/communities/{communityId}/links")
    CommunityService.LinkView link(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID communityId, @RequestBody LinkRequest body) {
        return communities.link(me.accountId(), communityId, decode(body.groupId(), "groupId"), body.visibility() == null ? "discoverable" : body.visibility());
    }

    @PostMapping("/v1/communities/{communityId}/links/{groupId}/accept")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void accept(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID communityId, @PathVariable String groupId) {
        communities.accept(me.accountId(), communityId, decode(groupId, "groupId"));
    }

    @DeleteMapping("/v1/communities/{communityId}/links/{groupId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void unlink(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID communityId, @PathVariable String groupId) {
        communities.unlink(me.accountId(), communityId, decode(groupId, "groupId"));
    }

    @PostMapping("/v1/communities/{communityId}/groups/{groupId}/join")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    void join(@AuthenticationPrincipal AuthenticatedDevice me, @PathVariable UUID communityId, @PathVariable String groupId) {
        communities.requestJoin(me.accountId(), communityId, decode(groupId, "groupId"));
    }
}
