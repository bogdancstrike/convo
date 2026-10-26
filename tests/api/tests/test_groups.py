"""Group delivery service contract (specs §6): creation, epoch-ordered commits, roles and owner
invariants, membership and device changes, bans, invites/join requests, leaving, group messages and
admin-only channels. MLS payloads are opaque to the server, so random bytes stand in for them."""
from __future__ import annotations

import os
import time
import uuid

import pytest

from convo_client import ApiError, Device
from convo_client.device import b64u


def gid() -> str:
    return b64u(os.urandom(32))


def dev(d: Device) -> dict:
    return {"accountId": d.account_id, "deviceId": d.device_id}


def create(owner: Device, members: list[Device] = (), admin_only: bool = False, group_id: str | None = None, epoch: int = 0, welcome=True) -> str:
    group_id = group_id or gid()
    owner.signed("POST", "/v1/groups", {"groupId": group_id, "epoch": epoch, "members": [m.account_id for m in members],
                                        "devices": [dev(m) for m in members], "welcome": b64u(os.urandom(200)) if welcome and members else None,
                                        "adminOnly": admin_only})
    return group_id


def commit(device: Device, group_id: str, epoch: int, submission: bytes | None = None, content: bytes | None = None, **changes):
    body = {"epoch": epoch, "submissionId": b64u(submission or os.urandom(16)), "commit": b64u(content or os.urandom(120)),
            "welcome": changes.pop("welcome", None), "addMembers": [], "removeMembers": [], "addDevices": [], "removeDevices": [], "roleChanges": {}}
    body.update(changes)
    return device.signed("POST", f"/v1/groups/{group_id}/commits", body)


def message(device: Device, group_id: str, epoch: int, submission: bytes | None = None, payload: bytes | None = None, interaction=False):
    return device.signed("PUT", f"/v1/groups/{group_id}/messages", {"epoch": epoch, "submissionId": b64u(submission or os.urandom(16)),
                                                                 "message": b64u(payload or os.urandom(80)), "urgent": False, "interaction": interaction})


def group(device: Device, group_id: str) -> dict:
    return device.signed("GET", f"/v1/groups/{group_id}")


def roles(device: Device, group_id: str) -> dict:
    return {m["accountId"]: m["role"] for m in group(device, group_id)["members"]}


def envelopes(device: Device, kind: str | None = None, expected: int = 1, timeout: float = 10) -> list:
    deadline, found = time.time() + timeout, []
    while time.time() < deadline:
        found = [e for e in device.drain()["envelopes"] if kind is None or e["type"] == kind]
        if len(found) >= expected:
            break
        time.sleep(0.2)
    for e in device.drain()["envelopes"]:
        device.ack(e["guid"])
    return found


@pytest.fixture()
def trio(make_device):
    return make_device("gowner"), make_device("gmember"), make_device("gother")


# --- creation ------------------------------------------------------------------------------------

def test_creator_is_owner_and_members_are_members(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    view = group(owner, g)
    assert view["epoch"] == 0 and roles(owner, g) == {owner.account_id: "owner", member.account_id: "member"}
    assert {(d["accountId"], d["deviceId"]) for d in view["devices"]} == {(owner.account_id, owner.device_id), (member.account_id, member.device_id)}


def test_initial_devices_get_the_welcome(trio):
    owner, member, _ = trio
    create(owner, [member])
    assert envelopes(member, "MLS_WELCOME")


def test_group_appears_in_my_groups(trio):
    owner, member, other = trio
    g = create(owner, [member])
    mine = {x["groupId"]: x for x in owner.signed("GET", "/v1/groups/mine")}
    assert mine[g]["role"] == "owner" and mine[g]["members"] == 2
    assert g in {x["groupId"] for x in member.signed("GET", "/v1/groups/mine")}
    assert g not in {x["groupId"] for x in other.signed("GET", "/v1/groups/mine")}


def test_creation_retry_is_idempotent_but_the_id_is_not_reusable(trio):
    owner, member, other = trio
    g = create(owner, [member])
    create(owner, [member], group_id=g)  # our own retry
    with pytest.raises(ApiError) as e:
        create(other, [], group_id=g)
    assert e.value.status == 400


@pytest.mark.parametrize("bad", ["", "short", "A" * 42, "!" * 43])
def test_group_id_must_be_32_bytes(alice, bad):
    with pytest.raises(ApiError) as e:
        alice.signed("POST", "/v1/groups", {"groupId": bad, "epoch": 0, "members": [], "devices": [], "welcome": None, "adminOnly": False})
    assert e.value.status == 400


def test_initial_device_must_belong_to_a_listed_member(trio):
    owner, member, other = trio
    with pytest.raises(ApiError) as e:
        owner.signed("POST", "/v1/groups", {"groupId": gid(), "epoch": 0, "members": [member.account_id], "devices": [dev(other)], "welcome": None, "adminOnly": False})
    assert e.value.status == 400


def test_non_members_cannot_read_a_group(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        group(other, g)
    assert e.value.code == "NOT_GROUP_MEMBER"


# --- commits ---------------------------------------------------------------------------------------

def test_commit_advances_the_epoch_and_reaches_other_devices(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    envelopes(member, "MLS_WELCOME")
    accepted = commit(owner, g, 0)
    assert accepted["epoch"] == 1 and accepted["duplicate"] is False
    assert group(owner, g)["epoch"] == 1
    commits = envelopes(member, "MLS_COMMIT")
    assert commits and commits[0]["groupId"] == g and commits[0]["epoch"] == 0


def test_stale_epoch_is_refused_with_the_current_one(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    commit(owner, g, 0)
    with pytest.raises(ApiError) as e:
        commit(member, g, 0)
    assert e.value.code == "EPOCH_CONFLICT" and e.value.body.get("currentEpoch") == 1


def test_commit_retry_is_a_duplicate_with_the_same_epoch(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    sub, content = os.urandom(16), os.urandom(100)
    first = commit(owner, g, 0, sub, content)
    again = commit(owner, g, 0, sub, content)
    assert again["duplicate"] is True and again["epoch"] == first["epoch"] and again["seq"] == first["seq"]


def test_commit_submission_id_cannot_be_reused_for_other_content(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    sub = os.urandom(16)
    commit(owner, g, 0, sub, b"one")
    with pytest.raises(ApiError) as e:
        commit(owner, g, 1, sub, b"two")
    assert e.value.code == "IDEMPOTENCY_CONFLICT"


def test_accepted_commit_can_be_looked_up_by_submission(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    sub = os.urandom(16)
    commit(owner, g, 0, sub)
    found = owner.signed("GET", f"/v1/groups/{g}/commits/{b64u(sub)}")
    assert found == {"epoch": 1, "seq": found["seq"], "duplicate": True}  # the resulting epoch
    with pytest.raises(ApiError) as e:  # never accepted: the client discards its pending commit
        owner.signed("GET", f"/v1/groups/{g}/commits/{b64u(os.urandom(16))}")
    assert e.value.status == 404


def test_catch_up_returns_commits_in_order(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    payloads = [os.urandom(50) for _ in range(4)]
    for i, p in enumerate(payloads):
        commit(owner, g, i, content=p)
    events = member.signed("GET", f"/v1/groups/{g}/events?fromEpoch=1")
    assert [e["epoch"] for e in events] == [1, 2, 3] and [e["commit"] for e in events] == [b64u(p) for p in payloads[1:]]


@pytest.mark.parametrize("size", [0, 1_100_000])  # limit: 1 MiB (enclave.groups.max-handshake-bytes)
def test_commit_size_is_bounded(trio, size):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        owner.signed("POST", f"/v1/groups/{g}/commits", {"epoch": 0, "submissionId": b64u(os.urandom(16)), "commit": b64u(os.urandom(size)) if size else "",
                                                           "addMembers": [], "removeMembers": [], "addDevices": [], "removeDevices": [], "roleChanges": {}})
    assert e.value.status in (400, 413)


# --- membership and roles ---------------------------------------------------------------------------

def test_admin_adds_a_member_with_device_and_welcome(trio):
    owner, member, other = trio
    g = create(owner, [member])
    commit(owner, g, 0, addMembers=[other.account_id], addDevices=[dev(other)], welcome=b64u(os.urandom(200)))
    assert roles(owner, g)[other.account_id] == "member"
    assert envelopes(other, "MLS_WELCOME")


def test_members_cannot_add_or_remove_others(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(member, g, 0, addMembers=[other.account_id], addDevices=[dev(other)])
    assert e.value.code == "FORBIDDEN_ROLE"
    with pytest.raises(ApiError) as e:
        commit(member, g, 0, removeMembers=[owner.account_id], removeDevices=[dev(owner)])
    assert e.value.code == "FORBIDDEN_ROLE"


def test_only_owners_change_roles(trio):
    owner, member, other = trio
    g = create(owner, [member, other])
    commit(owner, g, 0, roleChanges={member.account_id: "admin"})
    assert roles(owner, g)[member.account_id] == "admin"
    with pytest.raises(ApiError) as e:
        commit(member, g, 1, roleChanges={other.account_id: "admin"})
    assert e.value.code == "FORBIDDEN_ROLE"


def test_admins_manage_members_but_not_owners(trio):
    owner, admin, other = trio
    g = create(owner, [admin, other])
    commit(owner, g, 0, roleChanges={admin.account_id: "admin"})
    commit(admin, g, 1, removeMembers=[other.account_id], removeDevices=[dev(other)])
    assert other.account_id not in roles(owner, g)
    with pytest.raises(ApiError) as e:
        commit(admin, g, 2, removeMembers=[owner.account_id], removeDevices=[dev(owner)])
    assert e.value.code == "FORBIDDEN_ROLE"


def test_a_group_keeps_at_least_one_owner(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, roleChanges={owner.account_id: "member"})
    assert e.value.code == "FORBIDDEN_ROLE"
    commit(owner, g, 0, roleChanges={owner.account_id: "member", member.account_id: "owner"})
    assert roles(member, g) == {owner.account_id: "member", member.account_id: "owner"}


def test_committer_cannot_remove_itself(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, removeMembers=[owner.account_id], removeDevices=[dev(owner)])
    assert e.value.status == 400


def test_removed_member_must_lose_all_devices(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, removeMembers=[member.account_id])
    assert e.value.status == 400


def test_added_device_must_belong_to_a_member(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, addDevices=[dev(other)])
    assert e.value.status == 400


def test_removing_a_device_that_is_not_in_the_group_fails(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, removeDevices=[dev(other)])
    assert e.value.status == 400


def test_removed_member_receives_the_commit_but_no_later_messages(trio):
    owner, member, other = trio
    g = create(owner, [member, other])
    envelopes(other, "MLS_WELCOME")
    commit(owner, g, 0, removeMembers=[other.account_id], removeDevices=[dev(other)])
    assert envelopes(other, "MLS_COMMIT")  # learns it was removed
    message(owner, g, 1)
    time.sleep(0.5)
    assert envelopes(other, "MLS_PRIVATE", expected=1, timeout=1) == []
    with pytest.raises(ApiError) as e:
        message(other, g, 1)
    assert e.value.code == "NOT_GROUP_MEMBER"


# --- leaving -------------------------------------------------------------------------------------------

def test_leaving_marks_departure_and_others_complete_it(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    member.signed("POST", f"/v1/groups/{g}/leave")
    assert member.account_id in group(owner, g)["departed"]
    # Any member may complete a departure (remove the leaver's leaves).
    commit(owner, g, 0, removeMembers=[member.account_id], removeDevices=[dev(member)])
    view = group(owner, g)
    assert member.account_id not in roles(owner, g) and member.account_id not in view["departed"]


def test_last_owner_cannot_simply_leave_others_behind(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    try:
        owner.signed("POST", f"/v1/groups/{g}/leave")
    except ApiError as e:
        assert e.status in (400, 403, 409)
        return
    # If allowed, the group must not end up ownerless once the departure completes.
    with pytest.raises(ApiError):
        commit(member, g, 0, removeMembers=[owner.account_id], removeDevices=[dev(owner)])


# --- bans and invites ------------------------------------------------------------------------------

def test_banned_accounts_cannot_be_added_until_unbanned(trio):
    owner, member, other = trio
    g = create(owner, [member])
    owner.signed("PUT", f"/v1/groups/{g}/bans/{other.account_id}")
    assert other.account_id in owner.signed("GET", f"/v1/groups/{g}/bans")
    with pytest.raises(ApiError) as e:
        commit(owner, g, 0, addMembers=[other.account_id], addDevices=[dev(other)])
    assert e.value.code == "FORBIDDEN"
    owner.signed("DELETE", f"/v1/groups/{g}/bans/{other.account_id}")
    commit(owner, g, 0, addMembers=[other.account_id], addDevices=[dev(other)], welcome=b64u(os.urandom(100)))


def test_members_cannot_ban(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        member.signed("PUT", f"/v1/groups/{g}/bans/{other.account_id}")
    assert e.value.status == 403


def test_invite_link_join_request_and_decline(trio):
    owner, member, other = trio
    g = create(owner, [member])
    invite = owner.signed("POST", f"/v1/groups/{g}/invites")
    token = invite.get("token") or invite.get("link", "").rsplit("/", 1)[-1]
    other.signed("POST", f"/v1/invites/{token}/requests")
    requests_ = owner.signed("GET", f"/v1/groups/{g}/join-requests")
    assert other.account_id in [r["accountId"] for r in requests_]
    owner.signed("DELETE", f"/v1/groups/{g}/join-requests/{other.account_id}")
    assert other.account_id not in [r["accountId"] for r in owner.signed("GET", f"/v1/groups/{g}/join-requests")]


def test_revoked_invites_stop_working(trio):
    owner, member, other = trio
    g = create(owner, [member])
    invite = owner.signed("POST", f"/v1/groups/{g}/invites")
    token = invite.get("token") or invite.get("link", "").rsplit("/", 1)[-1]
    owner.signed("DELETE", f"/v1/groups/{g}/invites")
    with pytest.raises(ApiError) as e:
        other.signed("POST", f"/v1/invites/{token}/requests")
    assert e.value.status in (400, 404, 410)


def test_banned_accounts_cannot_request_to_join(trio):
    owner, member, other = trio
    g = create(owner, [member])
    owner.signed("PUT", f"/v1/groups/{g}/bans/{other.account_id}")
    invite = owner.signed("POST", f"/v1/groups/{g}/invites")
    token = invite.get("token") or invite.get("link", "").rsplit("/", 1)[-1]
    with pytest.raises(ApiError) as e:
        other.signed("POST", f"/v1/invites/{token}/requests")
    assert e.value.status in (403, 404)


def test_only_admins_see_join_requests(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        member.signed("GET", f"/v1/groups/{g}/join-requests")
    assert e.value.status == 403


# --- group messages and channels -----------------------------------------------------------------

def test_group_message_fans_out_to_other_devices(trio):
    owner, member, other = trio
    g = create(owner, [member, other])
    payload = os.urandom(90)
    assert message(owner, g, 0, payload=payload)["duplicate"] is False
    for d in (member, other):
        got = envelopes(d, "MLS_PRIVATE")
        assert got and got[0]["content"] == b64u(payload) and got[0]["groupId"] == g
    assert envelopes(owner, "MLS_PRIVATE", expected=1, timeout=1) == []  # not echoed to the sender


def test_group_message_retry_is_a_duplicate(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    sub, payload = os.urandom(16), os.urandom(40)
    message(owner, g, 0, sub, payload)
    assert message(owner, g, 0, sub, payload)["duplicate"] is True
    with pytest.raises(ApiError) as e:
        message(owner, g, 0, sub, os.urandom(40))
    assert e.value.code == "IDEMPOTENCY_CONFLICT"


def test_group_message_for_an_old_epoch_is_refused(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    commit(owner, g, 0)
    with pytest.raises(ApiError) as e:
        message(member, g, 0)
    assert e.value.code == "EPOCH_CONFLICT"


def test_non_members_cannot_post(trio):
    owner, member, other = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        message(other, g, 0)
    assert e.value.code == "NOT_GROUP_MEMBER"


def test_admin_only_channel_refuses_member_posts_but_admits_interactions(trio):
    owner, member, _ = trio
    g = create(owner, [member], admin_only=True)
    assert group(owner, g)["adminOnly"] is True
    message(owner, g, 0)
    with pytest.raises(ApiError) as e:
        message(member, g, 0)
    assert e.value.code == "FORBIDDEN_ROLE"
    assert message(member, g, 0, interaction=True)["ok"] is True


def test_group_message_size_is_bounded(trio):
    owner, member, _ = trio
    g = create(owner, [member])
    with pytest.raises(ApiError) as e:
        message(owner, g, 0, payload=os.urandom(1_200_000))
    assert e.value.status in (400, 413)


def test_unknown_group_is_not_found_for_members_and_strangers_alike(alice):
    g = gid()
    for call in (lambda: group(alice, g), lambda: message(alice, g, 0), lambda: commit(alice, g, 0)):
        with pytest.raises(ApiError) as e:
            call()
        assert e.value.code == "NOT_GROUP_MEMBER"
