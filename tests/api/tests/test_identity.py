"""Identity contract (specs §4–5, §12): enrollment and linking rules, devices, prekeys and their
single-use claims, KeyPackages, MLS bindings, directory, accounts and last-seen privacy."""
from __future__ import annotations

import concurrent.futures
import os
import uuid

import pytest

from convo_client import ApiError, Device
from convo_client.device import _djb_public, b64u


# --- enrollment --------------------------------------------------------------------------------------

def test_enrolled_device_sees_itself(alice):
    me = alice.signed("GET", "/v1/accounts/me")
    assert me["accountId"] == alice.account_id and me["deviceId"] == alice.device_id and me["identityKey"] == b64u(alice.identity_key)


def test_second_primary_enrollment_is_refused(kc):
    user = kc.create_user("twoprimary")
    Device.enroll(kc.user_token(user))
    with pytest.raises(ApiError) as e:
        Device.enroll(kc.user_token(user))
    assert e.value.code == "ACCOUNT_HAS_DEVICES"


def test_reservation_is_single_use(kc):
    user = kc.create_user("reuse")
    token = kc.user_token(user)
    d = Device()
    reservation = d.bearer("POST", "/v1/devices/reservations", token, {"purpose": "primary"})
    d.account_id, d.device_id = reservation["accountId"], reservation["deviceId"]
    import hashlib
    transcript = "\n".join(["ENCLAVE-ENROLL-V1", reservation["deploymentId"], d.address, reservation["reservationId"], reservation["challenge"],
                            b64u(d.identity_key), str(d.registration_id), b64u(hashlib.sha256(d.spki()).digest())]).encode()
    body = d.registration_body(reservation["reservationId"], transcript, "web", 5)
    d.bearer("POST", "/v1/devices/primary", token, body)
    again = d.bearer("POST", "/v1/devices/primary", token, body)  # same key: idempotent retry
    assert again["deviceId"] == d.device_id
    other = Device()
    body2 = other.registration_body(reservation["reservationId"], transcript, "web", 5)
    with pytest.raises(ApiError) as e:  # a different key on a used reservation
        other.bearer("POST", "/v1/devices/primary", token, body2)
    assert e.value.status in (400, 409)


@pytest.mark.parametrize("mutate,label", [
    (lambda b: b.update(identityKey=b64u(os.urandom(32))), "identity key without 0x05"),
    (lambda b: b.update(identityKey=b64u(b"\x05" + os.urandom(31))), "short identity key"),
    (lambda b: b.update(registrationId=0), "registration id 0"),
    (lambda b: b.update(registrationId=16384), "registration id too large"),
    (lambda b: b.update(platform="windows95"), "unknown platform"),
    (lambda b: b.update(signingKeyProfile="rsa-1024"), "unknown key profile"),
    (lambda b: b.update(registrationProof=b64u(os.urandom(64))), "wrong proof"),
    (lambda b: b.update(signingKey=b64u(os.urandom(91))), "malformed signing key"),
    (lambda b: b.update(signedPreKey=None), "missing signed prekey"),
], ids=lambda x: x if isinstance(x, str) else "")
def test_invalid_registrations_are_refused(kc, mutate, label):
    user = kc.create_user("badreg")
    token = kc.user_token(user)
    d = Device()
    reservation = d.bearer("POST", "/v1/devices/reservations", token, {"purpose": "primary"})
    d.account_id, d.device_id = reservation["accountId"], reservation["deviceId"]
    import hashlib
    transcript = "\n".join(["ENCLAVE-ENROLL-V1", reservation["deploymentId"], d.address, reservation["reservationId"], reservation["challenge"],
                            b64u(d.identity_key), str(d.registration_id), b64u(hashlib.sha256(d.spki()).digest())]).encode()
    body = d.registration_body(reservation["reservationId"], transcript, "web", 5)
    mutate(body)
    with pytest.raises(ApiError) as e:
        d.bearer("POST", "/v1/devices/primary", token, body)
    assert e.value.status == 400, label


@pytest.mark.parametrize("purpose", ["", "admin", "recovery", "PRIMARY"])
def test_reservation_purpose_is_validated(kc, purpose):
    token = kc.user_token(kc.create_user("purpose"))
    with pytest.raises(ApiError) as e:
        Device().bearer("POST", "/v1/devices/reservations", token, {"purpose": purpose})
    assert e.value.status == 400


def test_link_without_existing_devices_is_refused(kc):
    token = kc.user_token(kc.create_user("lonelylink"))
    with pytest.raises(ApiError) as e:
        Device().bearer("POST", "/v1/devices/reservations", token, {"purpose": "link"})
    assert e.value.status in (400, 409)


def test_linked_device_shares_the_identity_key(kc):
    user = kc.create_user("shareik")
    first = Device.enroll(kc.user_token(user))
    second = Device.link(kc.user_token(user), first)
    assert second.signed("GET", "/v1/accounts/me")["identityKey"] == b64u(first.identity_key)
    assert {d["deviceId"] for d in first.signed("GET", "/v1/devices")} == {first.device_id, second.device_id}


def test_link_with_a_wrong_code_is_refused(kc):
    user = kc.create_user("wrongcode")
    first = Device.enroll(kc.user_token(user))
    token = kc.user_token(user)
    d = Device(identity_key=first.identity_key)
    session = d.bearer("POST", "/v1/provisioning/sessions", token, {"ephemeralPublicKey": b64u(_djb_public()[1:])})
    d.account_id, d.device_id = session["accountId"], session["deviceId"]
    first.signed("POST", "/v1/devices/provisioning-code", {"provisioningId": session["provisioningId"]})
    import hashlib
    transcript = "\n".join(["ENCLAVE-ENROLL-V1", session["deploymentId"], d.address, session["reservationId"], session["challenge"],
                            b64u(d.identity_key), str(d.registration_id), b64u(hashlib.sha256(d.spki()).digest())]).encode()
    body = d.registration_body(session["reservationId"], transcript, "android", 5)
    body.pop("reservationId")
    with pytest.raises(ApiError) as e:
        d.bearer("POST", "/v1/devices/link", token, {**body, "provisioningId": session["provisioningId"], "provisioningCode": "000000000000"})
    assert e.value.code == "ENROLLMENT_INVALID"


def test_device_limit_is_enforced(kc):
    user = kc.create_user("limit")
    first = Device.enroll(kc.user_token(user))
    for _ in range(4):
        Device.link(kc.user_token(user), first)
    with pytest.raises(ApiError) as e:
        Device.link(kc.user_token(user), first)
    assert e.value.code == "DEVICE_LIMIT"


def test_provisioning_sessions_are_listed_only_to_the_same_account(kc, alice):
    user = kc.create_user("provlist")
    first = Device.enroll(kc.user_token(user))
    session = Device().bearer("POST", "/v1/provisioning/sessions", kc.user_token(user), {"ephemeralPublicKey": b64u(_djb_public()[1:])})
    assert session["provisioningId"] in [s["provisioningId"] for s in first.signed("GET", "/v1/provisioning/sessions")]
    assert session["provisioningId"] not in [s["provisioningId"] for s in alice.signed("GET", "/v1/provisioning/sessions")]
    with pytest.raises(ApiError):
        alice.signed("POST", "/v1/devices/provisioning-code", {"provisioningId": session["provisioningId"]})


def test_declined_provisioning_cannot_complete(kc):
    user = kc.create_user("declined")
    first = Device.enroll(kc.user_token(user))
    session = Device().bearer("POST", "/v1/provisioning/sessions", kc.user_token(user), {"ephemeralPublicKey": b64u(_djb_public()[1:])})
    first.signed("DELETE", f"/v1/provisioning/sessions/{session['provisioningId']}/approval")
    with pytest.raises(ApiError):
        first.signed("POST", "/v1/devices/provisioning-code", {"provisioningId": session["provisioningId"]})


# --- devices ---------------------------------------------------------------------------------------

def test_unlinking_another_device_and_the_self_route(kc):
    user = kc.create_user("unlink")
    first = Device.enroll(kc.user_token(user))
    second = Device.link(kc.user_token(user), first)
    with pytest.raises(ApiError) as e:
        first.signed("DELETE", f"/v1/devices/{first.device_id}")
    assert e.value.status == 400  # use /self for this device
    first.signed("DELETE", f"/v1/devices/{second.device_id}")
    assert [d["deviceId"] for d in first.signed("GET", "/v1/devices")] == [first.device_id]


def test_device_list_version_grows_with_changes(kc, alice):
    user = kc.create_user("version")
    first = Device.enroll(kc.user_token(user))
    v1 = alice.roster(first.account_id)["deviceListVersion"]
    second = Device.link(kc.user_token(user), first)
    v2 = alice.roster(first.account_id)["deviceListVersion"]
    first.signed("DELETE", f"/v1/devices/{second.device_id}")
    v3 = alice.roster(first.account_id)["deviceListVersion"]
    assert v1 < v2 < v3


def test_cannot_unlink_other_accounts_devices(alice, bob):
    with pytest.raises(ApiError) as e:
        alice.signed("DELETE", f"/v1/devices/{bob.device_id + 100}")
    assert e.value.status in (400, 404)
    assert bob.signed("GET", "/v1/accounts/me")["deviceId"] == bob.device_id


# --- prekeys ------------------------------------------------------------------------------------------

def test_claim_returns_one_bundle_per_device_and_consumes_a_prekey(make_device, alice):
    target = make_device("claimtarget")
    before = target.signed("GET", "/v1/keys/status")["oneTimePreKeys"]
    claim = alice.signed("POST", f"/v1/keys/{target.account_id}/claim", {})
    assert claim["identityKey"] == b64u(target.identity_key) and len(claim["devices"]) == 1
    bundle = claim["devices"][0]
    assert bundle["deviceId"] == target.device_id and bundle["registrationId"] == target.registration_id and bundle["preKey"]
    assert target.signed("GET", "/v1/keys/status")["oneTimePreKeys"] == before - 1


def test_concurrent_claims_never_hand_out_the_same_prekey(make_device):
    target = make_device("concurrent")
    claimers = [make_device("claimer") for _ in range(6)]
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        bundles = list(pool.map(lambda c: c.signed("POST", f"/v1/keys/{target.account_id}/claim", {}), claimers))
    ids = [b["devices"][0]["preKey"]["keyId"] for b in bundles if b["devices"][0].get("preKey")]
    assert len(ids) == len(set(ids)) == 6


def test_exhausted_prekeys_still_give_the_signed_prekey(make_device, alice):
    target = make_device("exhaust")
    left = target.signed("GET", "/v1/keys/status")["oneTimePreKeys"]
    for _ in range(left):
        alice.signed("POST", f"/v1/keys/{target.account_id}/claim", {})
    last = alice.signed("POST", f"/v1/keys/{target.account_id}/claim", {})
    assert last["devices"][0]["signedPreKey"] and not last["devices"][0].get("preKey")


def test_uploading_prekeys_refills_the_pool(alice):
    before = alice.signed("GET", "/v1/keys/status")["oneTimePreKeys"]
    alice.signed("PUT", "/v1/keys", {"preKeys": [{"keyId": 1000 + i, "publicKey": b64u(_djb_public())} for i in range(10)]})
    assert alice.signed("GET", "/v1/keys/status")["oneTimePreKeys"] == before + 10


def test_signed_prekey_can_be_rotated(alice, bob):
    new = {"keyId": 777, "publicKey": b64u(_djb_public()), "signature": b64u(os.urandom(64))}
    alice.signed("PUT", "/v1/keys", {"signedPreKey": new, "preKeys": []})
    bundle = bob.signed("POST", f"/v1/keys/{alice.account_id}/claim", {})["devices"][0]
    assert bundle["signedPreKey"]["keyId"] == 777


def test_prekey_upload_is_bounded(alice):
    with pytest.raises(ApiError) as e:
        alice.signed("PUT", "/v1/keys", {"preKeys": [{"keyId": i, "publicKey": b64u(_djb_public())} for i in range(1001)]})
    assert e.value.status in (400, 413)


def test_claim_for_unknown_account_is_not_found(alice):
    with pytest.raises(ApiError) as e:
        alice.signed("POST", f"/v1/keys/{uuid.uuid4()}/claim", {})
    assert e.value.status == 404


def test_claim_can_select_devices(kc, alice):
    user = kc.create_user("select")
    first = Device.enroll(kc.user_token(user))
    second = Device.link(kc.user_token(user), first)
    claim = alice.signed("POST", f"/v1/keys/{first.account_id}/claim", {"deviceIds": [second.device_id]})
    assert [b["deviceId"] for b in claim["devices"]] == [second.device_id]


# --- KeyPackages and MLS bindings ---------------------------------------------------------------------

def test_keypackages_upload_claim_and_status(make_device, alice):
    target = make_device("kp")
    target.signed("PUT", "/v1/keypackages", {"keyPackages": [{"ref": b64u(os.urandom(32)), "keyPackage": b64u(os.urandom(300))} for _ in range(3)]})
    assert target.signed("GET", "/v1/keypackages/status")["oneTimePreKeys"] == 3
    claimed = alice.signed("POST", "/v1/keypackages/claim", {"accountIds": [target.account_id]})
    assert len(claimed["keyPackages"]) == 1 and claimed["keyPackages"][0]["deviceId"] == target.device_id
    assert target.signed("GET", "/v1/keypackages/status")["oneTimePreKeys"] == 2


def test_devices_without_keypackages_are_reported_unavailable(make_device, alice):
    target = make_device("nokp")
    claimed = alice.signed("POST", "/v1/keypackages/claim", {"accountIds": [target.account_id]})
    assert claimed["keyPackages"] == [] and claimed["unavailable"] == [{"accountId": target.account_id, "deviceId": target.device_id}]


def test_keypackage_size_is_bounded(alice):
    with pytest.raises(ApiError) as e:
        alice.signed("PUT", "/v1/keypackages", {"keyPackages": [{"ref": b64u(os.urandom(32)), "keyPackage": b64u(os.urandom(9000))}]})
    assert e.value.status in (400, 413)


def test_mls_binding_publish_and_read(alice, bob):
    key, binding = os.urandom(32), os.urandom(64)
    alice.signed("PUT", "/v1/devices/self/mls-binding", {"signatureKey": b64u(key), "binding": b64u(binding)})
    bindings = bob.signed("GET", f"/v1/accounts/{alice.account_id}/mls-bindings")
    assert {"deviceId": alice.device_id, "signatureKey": b64u(key), "binding": b64u(binding)} in bindings


@pytest.mark.parametrize("key_len,binding_len", [(31, 64), (32, 63), (33, 64), (32, 65), (0, 64)])
def test_mls_binding_sizes_are_validated(alice, key_len, binding_len):
    with pytest.raises(ApiError) as e:
        alice.signed("PUT", "/v1/devices/self/mls-binding", {"signatureKey": b64u(os.urandom(key_len)) or "A", "binding": b64u(os.urandom(binding_len))})
    assert e.value.status == 400


# --- directory and accounts ---------------------------------------------------------------------------

def test_directory_finds_by_handle_and_name(alice, kc):
    target = Device.enroll(kc.user_token(user := kc.create_user("findme")))
    by_handle = alice.signed("GET", f"/v1/directory/search?q={user.username}")
    assert target.account_id in [a["accountId"] for a in by_handle]
    by_name = alice.signed("GET", f"/v1/directory/search?q={user.name.split()[1]}")
    assert target.account_id in [a["accountId"] for a in by_name]


def test_directory_finds_by_phone_digits(alice, kc):
    user = kc.create_user("phoneme")
    target = Device.enroll(kc.user_token(user))
    digits = "".join(c for c in user.phone if c.isdigit())[-8:]
    assert target.account_id in [a["accountId"] for a in alice.signed("GET", f"/v1/directory/search?q={digits}")]


def test_directory_hides_accounts_without_devices(alice, kc):
    user = kc.create_user("nodevice")
    kc.user_token(user)  # signs in once (account provisioned on enrollment only)
    assert user.username not in [a["username"] for a in alice.signed("GET", f"/v1/directory/search?q={user.username}")]


@pytest.mark.parametrize("q", ["%", "_", "%%%", "' OR 1=1 --", "\\", "a" * 200])
def test_directory_treats_wildcards_literally(alice, q):
    import urllib.parse
    results = alice.signed("GET", f"/v1/directory/search?q={urllib.parse.quote(q)}")
    assert isinstance(results, list) and len(results) <= 50


def test_account_lookup_and_unknown_account(alice, bob):
    assert alice.signed("GET", f"/v1/accounts/{bob.account_id}")["username"] == bob.user.username
    with pytest.raises(ApiError) as e:
        alice.signed("GET", f"/v1/accounts/{uuid.uuid4()}")
    assert e.value.status == 404


# --- last seen ----------------------------------------------------------------------------------------------

def test_last_seen_is_hidden_until_shared(make_device, alice):
    target = make_device("lastseen")
    target.signed("POST", "/v1/privacy/last-seen/heartbeat")
    assert alice.signed("GET", f"/v1/accounts/{target.account_id}/last-seen")["at"] is None
    target.signed("PUT", "/v1/privacy/last-seen", {"shareLastSeen": True})
    assert target.signed("GET", "/v1/privacy/last-seen") == {"shareLastSeen": True}
    target.signed("POST", "/v1/privacy/last-seen/heartbeat")
    assert alice.signed("GET", f"/v1/accounts/{target.account_id}/last-seen")["at"] is not None
    target.signed("PUT", "/v1/privacy/last-seen", {"shareLastSeen": False})
    assert alice.signed("GET", f"/v1/accounts/{target.account_id}/last-seen")["at"] is None


def test_last_seen_privacy_requires_a_boolean(alice):
    with pytest.raises(ApiError) as e:
        alice.signed("PUT", "/v1/privacy/last-seen", {"shareLastSeen": None})
    assert e.value.status == 400


def test_credential_status_is_readable(alice):
    status = alice.signed("GET", "/v1/account/credentials")
    assert isinstance(status, dict)
