"""Direct messaging contract (specs §5.3): all-or-nothing fan-out per device roster, idempotent
submissions, mailbox delivery and acknowledgement, WebSocket delivery and limits."""
from __future__ import annotations

import os
import time
import uuid

import pytest

from convo_client import ApiError, Device
from convo_client.device import b64u


def send_raw(sender: Device, destination: str, messages: list, submission: bytes | None = None, urgent=False, ttl=0, path_dest: str | None = None):
    return sender.signed("PUT", f"/v1/messages/{path_dest or destination}", {
        "destination": destination, "submissionId": b64u(submission or os.urandom(16)), "messages": messages, "urgent": urgent, "transientTtlSeconds": ttl})


def msg(device_id: int, registration_id: int, content: bytes | None = None, kind: str = "CIPHERTEXT"):
    return {"deviceId": device_id, "registrationId": registration_id, "type": kind, "content": b64u(content if content is not None else os.urandom(64))}


@pytest.fixture()
def pair(make_device):
    return make_device("msgsender"), make_device("msgreceiver")


@pytest.fixture(scope="module")
def two_device_account(kc):
    user = kc.create_user("twodev")
    first = Device.enroll(kc.user_token(user))
    second = Device.link(kc.user_token(user), first)
    return first, second


def drain_all(device: Device, expected: int, timeout: float = 10) -> list:
    deadline, seen = time.time() + timeout, []
    while time.time() < deadline:
        seen = device.drain()["envelopes"]
        if len(seen) >= expected:
            return seen
        time.sleep(0.2)
    return seen


# --- delivery -------------------------------------------------------------------------------------

def test_message_is_delivered_once_and_removed_after_ack(pair):
    sender, receiver = pair
    assert sender.send_to(receiver.account_id) == {"ok": True, "duplicate": False}
    envelopes = drain_all(receiver, 1)
    assert len(envelopes) == 1
    env = envelopes[0]
    assert env["sourceAccount"] == sender.account_id and env["sourceDevice"] == sender.device_id and env["type"] == "CIPHERTEXT"
    receiver.ack(env["guid"])
    assert receiver.drain()["envelopes"] == []


def test_ciphertext_is_delivered_byte_for_byte(pair):
    sender, receiver = pair
    payload = os.urandom(777)
    roster = sender.roster(receiver.account_id)
    send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], payload) for d in roster["devices"]])
    assert drain_all(receiver, 1)[0]["content"] == b64u(payload)


def test_ack_is_idempotent_and_unknown_guids_are_harmless(pair):
    sender, receiver = pair
    sender.send_to(receiver.account_id)
    guid = drain_all(receiver, 1)[0]["guid"]
    receiver.ack(guid)
    receiver.ack(guid)
    receiver.ack(str(uuid.uuid4()))


def test_another_device_cannot_ack_my_envelope(pair, make_device):
    sender, receiver = pair
    stranger = make_device("stranger")
    sender.send_to(receiver.account_id)
    guid = drain_all(receiver, 1)[0]["guid"]
    stranger.ack(guid)  # accepted as a no-op …
    assert [e["guid"] for e in receiver.drain()["envelopes"]] == [guid]  # … but the envelope stays queued


def test_messages_arrive_in_order(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    sent = []
    for i in range(8):
        payload = f"message {i}".encode()
        sent.append(b64u(payload))
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], payload) for d in roster["devices"]])
    assert [e["content"] for e in drain_all(receiver, 8)] == sent


def test_drain_is_paged(pair):
    sender, receiver = pair
    for _ in range(5):
        sender.send_to(receiver.account_id)
    drain_all(receiver, 5)
    page = receiver.drain(limit=2)
    assert len(page["envelopes"]) == 2 and page["more"] is True


def test_websocket_delivers_new_messages_live(pair):
    sender, receiver = pair
    box = receiver.socket()
    try:
        sender.send_to(receiver.account_id)
        assert box.receive(1, timeout=15)[0]["sourceAccount"] == sender.account_id
    finally:
        box.close()


def test_websocket_ack_removes_envelope(pair):
    sender, receiver = pair
    box = receiver.socket()
    try:
        sender.send_to(receiver.account_id)
        box.receive(1, timeout=15)
        time.sleep(0.5)
    finally:
        box.close()
    assert receiver.drain()["envelopes"] == []


def test_websocket_redelivers_unacknowledged_envelopes(pair):
    sender, receiver = pair
    sender.send_to(receiver.account_id)
    first = receiver.socket()
    try:
        guid = first.receive(1, timeout=15, ack=False)[0]["guid"]
    finally:
        first.close()
    second = receiver.socket()
    try:
        assert second.receive(1, timeout=15)[0]["guid"] == guid
    finally:
        second.close()


def test_websocket_ticket_is_single_use(alice):
    import ssl
    import websocket
    ticket = alice.signed("POST", "/v1/ws/tickets")["ticket"]
    url = alice.base_url.replace("https://", "wss://") + "/v1/ws"
    ws = websocket.create_connection(url, subprotocols=["enclave.v1", f"ticket.{ticket}"], origin=alice.base_url, sslopt={"cert_reqs": ssl.CERT_NONE})
    ws.close()
    with pytest.raises(Exception):
        websocket.create_connection(url, subprotocols=["enclave.v1", f"ticket.{ticket}"], origin=alice.base_url, sslopt={"cert_reqs": ssl.CERT_NONE})


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://localhost:8443"])
def test_websocket_refuses_foreign_origins(alice, origin):
    import ssl
    import websocket
    ticket = alice.signed("POST", "/v1/ws/tickets")["ticket"]
    url = alice.base_url.replace("https://", "wss://") + "/v1/ws"
    with pytest.raises(Exception):
        websocket.create_connection(url, subprotocols=["enclave.v1", f"ticket.{ticket}"], origin=origin, sslopt={"cert_reqs": ssl.CERT_NONE})


@pytest.mark.parametrize("ticket", ["", "x" * 43, "not-a-ticket"])
def test_websocket_refuses_invalid_tickets(alice, ticket):
    import ssl
    import websocket
    url = alice.base_url.replace("https://", "wss://") + "/v1/ws"
    with pytest.raises(Exception):
        websocket.create_connection(url, subprotocols=["enclave.v1", f"ticket.{ticket}"], origin=alice.base_url, sslopt={"cert_reqs": ssl.CERT_NONE})


# --- multi-device fan-out --------------------------------------------------------------------------

def test_every_recipient_device_gets_its_own_copy(alice, two_device_account):
    first, second = two_device_account
    alice.send_to(first.account_id)
    for device in (first, second):
        envelopes = drain_all(device, 1)
        assert len(envelopes) >= 1 and envelopes[-1]["sourceAccount"] == alice.account_id
        for e in envelopes:
            device.ack(e["guid"])


def test_own_device_sync_excludes_the_sender_device(two_device_account):
    first, second = two_device_account
    first.send_to(first.account_id)  # own-device sync: only the other device
    envelopes = drain_all(second, 1)
    assert envelopes and envelopes[-1]["sourceDevice"] == first.device_id
    for e in envelopes:
        second.ack(e["guid"])


def test_sending_to_own_device_is_refused(two_device_account):
    first, _ = two_device_account
    roster = first.roster(first.account_id)
    with pytest.raises(ApiError) as e:
        send_raw(first, first.account_id, [msg(d["deviceId"], d["registrationId"]) for d in roster["devices"]])
    assert e.value.code == "DEVICE_MISMATCH" and first.device_id in e.value.body["extra"]


def test_missing_device_is_reported(alice, two_device_account):
    first, _ = two_device_account
    roster = alice.roster(first.account_id)
    only_one = roster["devices"][:1]
    with pytest.raises(ApiError) as e:
        send_raw(alice, first.account_id, [msg(d["deviceId"], d["registrationId"]) for d in only_one])
    assert e.value.code == "DEVICE_MISMATCH" and len(e.value.body["missing"]) == 1
    assert e.value.body["deviceListVersion"] == roster["deviceListVersion"]


def test_unknown_device_is_reported_as_extra(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    messages = [msg(d["deviceId"], d["registrationId"]) for d in roster["devices"]] + [msg(99, 1)]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, messages)
    assert e.value.code == "DEVICE_MISMATCH" and e.value.body["extra"] == [99]


def test_reregistered_device_is_reported_stale(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], (d["registrationId"] % 16000) + 1) for d in roster["devices"]])
    assert e.value.code == "STALE_DEVICES" and e.value.body["stale"] == [d["deviceId"] for d in roster["devices"]]


def test_mismatch_stores_nothing(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    with pytest.raises(ApiError):
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"]) for d in roster["devices"]] + [msg(42, 7)])
    time.sleep(0.5)
    assert receiver.drain()["envelopes"] == []


def test_revoked_device_receives_nothing(alice, kc):
    user = kc.create_user("revokedrecv")
    first = Device.enroll(kc.user_token(user))
    second = Device.link(kc.user_token(user), first)
    first.signed("DELETE", f"/v1/devices/{second.device_id}")
    roster = alice.roster(first.account_id)
    assert [d["deviceId"] for d in roster["devices"]] == [first.device_id]
    with pytest.raises(ApiError) as e:
        send_raw(alice, first.account_id, [msg(d, 1) for d in (first.device_id, second.device_id)])
    assert e.value.code in ("DEVICE_MISMATCH", "STALE_DEVICES")


# --- idempotency -------------------------------------------------------------------------------------

def test_resubmission_is_a_duplicate_and_stores_once(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    submission = os.urandom(16)
    messages = [msg(d["deviceId"], d["registrationId"], b"same") for d in roster["devices"]]
    assert send_raw(sender, receiver.account_id, messages, submission) == {"ok": True, "duplicate": False}
    assert send_raw(sender, receiver.account_id, messages, submission) == {"ok": True, "duplicate": True}
    time.sleep(0.3)
    assert len(receiver.drain()["envelopes"]) == 1


def test_reusing_a_submission_id_with_other_content_conflicts(pair):
    sender, receiver = pair
    roster = sender.roster(receiver.account_id)
    submission = os.urandom(16)
    send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], b"one") for d in roster["devices"]], submission)
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], b"two") for d in roster["devices"]], submission)
    assert e.value.code == "IDEMPOTENCY_CONFLICT"


def test_submission_ids_are_per_sender(pair, make_device):
    sender, receiver = pair
    other = make_device("othersender")
    submission = os.urandom(16)
    for s in (sender, other):
        roster = s.roster(receiver.account_id)
        assert send_raw(s, receiver.account_id, [msg(d["deviceId"], d["registrationId"]) for d in roster["devices"]], submission)["duplicate"] is False


# --- validation ----------------------------------------------------------------------------------------

@pytest.mark.parametrize("length", [0, 5, 15, 17, 64])
def test_submission_id_must_be_16_bytes(pair, length):
    sender, receiver = pair
    submission = os.urandom(length)
    roster = sender.roster(receiver.account_id)
    with pytest.raises(ApiError) as e:
        sender.signed("PUT", f"/v1/messages/{receiver.account_id}", {"destination": receiver.account_id, "submissionId": b64u(submission),
                                                                     "messages": [msg(d["deviceId"], d["registrationId"]) for d in roster["devices"]],
                                                                     "urgent": False, "transientTtlSeconds": 0})
    assert e.value.status == 400


def test_empty_message_list_is_refused(pair):
    sender, receiver = pair
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [])
    assert e.value.status == 400


def test_duplicate_device_entries_are_refused(pair):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"]), msg(d["deviceId"], d["registrationId"])])
    assert e.value.status == 400


@pytest.mark.parametrize("kind", ["MLS_PRIVATE", "MLS_COMMIT", "MLS_WELCOME", "NOT_A_TYPE"])
def test_group_envelope_types_are_refused_for_direct_sends(pair, kind):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], kind=kind)])
    assert e.value.status == 400


def test_prekey_messages_are_accepted(pair):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    assert send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], kind="PREKEY_MESSAGE")])["ok"]
    assert drain_all(receiver, 1)[0]["type"] == "PREKEY_MESSAGE"


def test_empty_ciphertext_is_refused(pair):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], b"")])
    assert e.value.status == 400


def test_oversized_ciphertext_is_refused(pair):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"], os.urandom(1_200_000))])
    assert e.value.status in (400, 413)


@pytest.mark.parametrize("ttl", [-1, 10**9])
def test_transient_ttl_must_be_in_range(pair, ttl):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"])], ttl=ttl)
    assert e.value.status == 400


def test_transient_messages_carry_their_short_expiry(pair):
    sender, receiver = pair
    d = sender.roster(receiver.account_id)["devices"][0]
    send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"])], ttl=30)
    env = drain_all(receiver, 1)[0]
    assert env["expiresAt"] - env["serverTimestamp"] <= 31_000


def test_urgent_flag_is_delivered(pair):
    sender, receiver = pair
    sender.send_to(receiver.account_id, urgent=True)
    assert drain_all(receiver, 1)[0]["urgent"] is True


def test_path_and_body_destination_must_agree(pair, make_device):
    sender, receiver = pair
    other = make_device("otherdest")
    d = sender.roster(receiver.account_id)["devices"][0]
    with pytest.raises(ApiError) as e:
        send_raw(sender, receiver.account_id, [msg(d["deviceId"], d["registrationId"])], path_dest=other.account_id)
    assert e.value.status == 400


def test_unknown_destination_is_not_found(alice):
    with pytest.raises(ApiError) as e:
        send_raw(alice, str(uuid.uuid4()), [msg(1, 1)])
    assert e.value.status == 404


def test_server_timestamp_is_recent(pair):
    sender, receiver = pair
    sender.send_to(receiver.account_id)
    env = drain_all(receiver, 1)[0]
    assert abs(env["serverTimestamp"] - time.time() * 1000) < 60_000
