package com.enclave.communities.internal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.enclave.contracts.EnclaveException;
import com.enclave.contracts.ErrorCode;
import com.enclave.groups.GroupsApi;
import java.util.*;
import org.junit.jupiter.api.Test;

class CommunityServiceTest {
    /** In-memory repository (same SQL semantics: one parent per group). */
    static class FakeRepo extends CommunityRepository {
        final Map<UUID, Community> communities = new LinkedHashMap<>();
        final Map<String, Link> links = new LinkedHashMap<>();
        FakeRepo() { super(null); }
        @Override void insert(UUID id, byte[] root, UUID by) { communities.put(id, new Community(id, root, 1)); }
        @Override Optional<Community> find(UUID id) { return Optional.ofNullable(communities.get(id)); }
        @Override List<Community> all() { return List.copyOf(communities.values()); }
        @Override boolean isRoot(byte[] g) { return communities.values().stream().anyMatch(c -> Arrays.equals(c.rootGroupId(), g)); }
        @Override Optional<Link> linkOf(byte[] g) { return Optional.ofNullable(links.get(Arrays.toString(g))); }
        @Override List<Link> links(UUID c) { return links.values().stream().filter(l -> l.communityId().equals(c)).toList(); }
        @Override long countLinks(UUID c) { return links(c).size(); }
        final Map<String, String> ops = new LinkedHashMap<>();
        @Override void propose(UUID c, byte[] g, String v, UUID by, boolean accepted, boolean d) { links.put(Arrays.toString(g), new Link(c, g, v, accepted ? "active" : "proposed", by, 1, accepted && d)); }
        @Override void accept(UUID c, byte[] g, UUID by, boolean d) { var l = links.get(Arrays.toString(g)); links.put(Arrays.toString(g), new Link(c, g, l.visibility(), "active", l.proposedBy(), l.version() + 1, d)); }
        @Override Optional<Community> byRoot(byte[] g) { return communities.values().stream().filter(c -> Arrays.equals(c.rootGroupId(), g)).findFirst(); }
        @Override void recordOperation(UUID c, byte[] g, UUID a, String s) { ops.put(Arrays.toString(g) + a, s); }
        @Override List<Operation> operations(UUID c) { return ops.entrySet().stream().map(e -> new Operation(new byte[32], UUID.randomUUID(), e.getValue(), java.time.Instant.EPOCH)).toList(); }
        @Override int completeOperations(byte[] g, java.util.Collection<UUID> accounts) {
            int n = 0; for (UUID a : accounts) if ("pending".equals(ops.get(Arrays.toString(g) + a))) { ops.put(Arrays.toString(g) + a, "completed"); n++; } return n;
        }
        @Override void unlink(UUID c, byte[] g) { links.remove(Arrays.toString(g)); }
    }

    static class FakeGroups implements GroupsApi {
        final Map<String, GroupSummary> groups = new HashMap<>();
        final List<String> joinRequests = new ArrayList<>();
        void put(byte[] id, boolean adminOnly, Object... roles) {
            Map<UUID, String> r = new LinkedHashMap<>();
            for (int i = 0; i < roles.length; i += 2) r.put((UUID) roles[i], (String) roles[i + 1]);
            groups.put(Arrays.toString(id), new GroupSummary(r, adminOnly));
        }
        @Override public Optional<Set<UUID>> members(byte[] g) { return summary(g).map(s -> s.roles().keySet()); }
        @Override public Optional<GroupSummary> summary(byte[] g) { return Optional.ofNullable(groups.get(Arrays.toString(g))); }
        @Override public void requestToJoin(byte[] g, UUID a) { joinRequests.add(Arrays.toString(g) + a); }
        final List<String> removed = new ArrayList<>();
        @Override public RemovalOutcome removeOnBehalf(byte[] g, UUID a) {
            var s = groups.get(Arrays.toString(g));
            if (s == null || !s.roles().containsKey(a)) return RemovalOutcome.NOT_MEMBER;
            if (s.isOwner(a) && s.roles().values().stream().filter("owner"::equals).count() == 1 && s.roles().size() > 1) return RemovalOutcome.LAST_OWNER;
            removed.add(Arrays.toString(g) + a);
            Map<UUID, String> r = new LinkedHashMap<>(s.roles()); r.remove(a); groups.put(Arrays.toString(g), new GroupSummary(r, s.adminOnly()));
            return RemovalOutcome.REMOVED;
        }
        @Override public List<byte[]> groupsOf(UUID a) {
            List<byte[]> out = new ArrayList<>();
            groups.forEach((k, s) -> { if (s.roles().containsKey(a)) out.add(parse(k)); });
            return out;
        }
        static byte[] parse(String s) {
            String[] parts = s.substring(1, s.length() - 1).split(", ");
            byte[] b = new byte[parts.length];
            for (int i = 0; i < parts.length; i++) b[i] = Byte.parseByte(parts[i]);
            return b;
        }
    }

    final UUID owner = UUID.randomUUID(), admin = UUID.randomUUID(), member = UUID.randomUUID(), outsider = UUID.randomUUID(), subOwner = UUID.randomUUID();
    final byte[] root = id(1), chat = id(2), team = id(3), secret = id(4), plain = id(5);
    final FakeRepo repo = new FakeRepo();
    final FakeGroups groups = new FakeGroups();
    final CommunityService service = new CommunityService(repo, groups);

    static byte[] id(int n) { byte[] b = new byte[32]; b[0] = (byte) n; return b; }

    private UUID community() {
        groups.put(root, true, owner, "owner", admin, "admin", member, "member", subOwner, "member");
        groups.put(chat, false, owner, "owner", member, "member");
        groups.put(team, false, subOwner, "owner", member, "member");
        groups.put(secret, false, owner, "owner");
        groups.put(plain, false, owner, "owner", outsider, "member");
        return service.create(owner, root).communityId();
    }

    private static void assertCode(Runnable action, ErrorCode code) {
        assertThatThrownBy(action::run).isInstanceOfSatisfying(EnclaveException.class, e -> assertThat(e.code()).isEqualTo(code));
    }

    @Test void onlyTheOwnerOfAnAnnouncementChannelCreatesACommunity() {
        groups.put(root, true, owner, "owner", admin, "admin");
        groups.put(chat, false, owner, "owner");
        assertCode(() -> service.create(admin, root), ErrorCode.FORBIDDEN_ROLE);
        assertCode(() -> service.create(owner, chat), ErrorCode.POLICY_VIOLATION);
        service.create(owner, root);
        assertCode(() -> service.create(owner, root), ErrorCode.POLICY_VIOLATION);
        assertThat(service.mine(admin)).singleElement().satisfies(c -> assertThat(c.role()).isEqualTo("admin"));
        assertThat(service.mine(outsider)).isEmpty();
    }

    @Test void linkingNeedsBothAuthoritiesAndOneParent() {
        UUID c = community();
        // Owner of both: active at once.
        assertThat(service.link(owner, c, chat, "discoverable", false).status()).isEqualTo("active");
        // A community admin proposes a group they don't own: the group owner must accept.
        assertThat(service.link(admin, c, team, "discoverable", false).status()).isEqualTo("proposed");
        assertThat(service.groups(subOwner, c)).filteredOn(l -> l.status().equals("proposed")).singleElement().satisfies(l -> assertThat(l.canAccept()).isTrue());
        assertCode(() -> service.accept(admin, c, team, false), ErrorCode.FORBIDDEN_ROLE);
        service.accept(subOwner, c, team, false);
        // Ordinary members cannot link; no group gets two parents; roots are never subgroups.
        assertCode(() -> service.link(member, c, secret, "private", false), ErrorCode.FORBIDDEN_ROLE);
        assertCode(() -> service.link(owner, c, chat, "discoverable", false), ErrorCode.POLICY_VIOLATION);
        assertCode(() -> service.link(owner, c, root, "discoverable", false), ErrorCode.POLICY_VIOLATION);
        // Members outside the community block activation (no silent enrollment).
        assertCode(() -> service.link(owner, c, plain, "discoverable", false), ErrorCode.POLICY_VIOLATION);
    }

    @Test void discoveryShowsOnlyWhatTheCallerMaySee() {
        UUID c = community();
        service.link(owner, c, chat, "discoverable", false);
        service.link(owner, c, secret, "private", false);
        service.link(admin, c, team, "discoverable", false); // proposed
        // Ordinary member: the active discoverable group only (and they are in it).
        assertThat(service.groups(member, c)).extracting(CommunityService.LinkView::groupId).containsExactly(CommunityService.hex(chat), CommunityService.hex(team));
        assertThat(service.groups(subOwner, c)).extracting(CommunityService.LinkView::groupId).containsExactly(CommunityService.hex(chat), CommunityService.hex(team));
        // Admins see private and proposed links; outsiders learn nothing.
        assertThat(service.groups(admin, c)).hasSize(3);
        assertCode(() -> service.groups(outsider, c), ErrorCode.NOT_FOUND);
    }

    @Test void membersAskToJoinOnlyDiscoverableActiveGroups() {
        UUID c = community();
        service.link(owner, c, chat, "discoverable", false);
        service.link(owner, c, secret, "private", false);
        service.requestJoin(subOwner, c, chat);
        assertThat(groups.joinRequests).hasSize(1);
        assertCode(() -> service.requestJoin(subOwner, c, secret), ErrorCode.NOT_FOUND);
        assertCode(() -> service.requestJoin(outsider, c, chat), ErrorCode.NOT_FOUND);
    }

    @Test void eitherAuthorityMayUnlink() {
        UUID c = community();
        service.link(admin, c, team, "discoverable", false);
        service.accept(subOwner, c, team, false);
        assertCode(() -> service.unlink(member, c, team), ErrorCode.FORBIDDEN_ROLE);
        service.unlink(subOwner, c, team);
        assertThat(service.groups(admin, c)).isEmpty();
    }

    @Test void removalFromTheCommunityFollowsOnlyIntoDelegatingGroups() {
        UUID c = community();
        service.link(owner, c, chat, "discoverable", true);      // owner grants delegation
        service.link(admin, c, team, "discoverable", false);
        service.accept(subOwner, c, team, false);                  // team stays standalone
        service.onRootRemoval(root, Set.of(member));
        assertThat(groups.removed).containsExactly(Arrays.toString(chat) + member);
        assertThat(repo.ops).containsEntry(Arrays.toString(chat) + member, "pending");
        service.onGroupRemovalCommitted(chat, Set.of(member));
        assertThat(repo.ops).containsEntry(Arrays.toString(chat) + member, "completed");
        // Not a root: no cascade. A last owner is never stranded.
        service.onRootRemoval(team, Set.of(subOwner));
        groups.put(chat, false, owner, "owner", subOwner, "member");
        service.onRootRemoval(root, Set.of(owner));
        assertThat(repo.ops).containsEntry(Arrays.toString(chat) + owner, "blocked");
        assertThat(service.operations(admin, c)).extracting(CommunityService.OperationView::status).containsExactlyInAnyOrder("completed", "blocked");
        assertCode(() -> service.operations(subOwner, c), ErrorCode.FORBIDDEN_ROLE); // community admins only
    }
}
