"""Authentication and authorization of every endpoint (OWASP ASVS V2/V3/V4): who may call what."""
from __future__ import annotations

import base64
import json
import os
import time

import pytest

from conftest import admin_endpoints, device_endpoints, endpoint_id, fill, kind, ENDPOINTS
from convo_client.device import Device, b64u

DEVICE = device_endpoints()
ADMIN = admin_endpoints()
BODY_METHODS = {"POST", "PUT", "PATCH"}


def problem_code(r):
    try:
        return r.json().get("code")
    except ValueError:
        return None


@pytest.mark.parametrize("e", DEVICE, ids=endpoint_id)
def test_device_endpoint_refuses_no_credentials(alice, e):
    r = alice.raw_request(e["method"], fill(e["path"]), {}, b"{}" if e["method"] in BODY_METHODS else b"")
    assert r.status_code == 401, r.text[:200]


@pytest.mark.parametrize("e", DEVICE, ids=endpoint_id)
def test_device_endpoint_refuses_forged_signature(alice, e):
    path = fill(e["path"], {"accountId": alice.account_id})
    body = b"{}" if e["method"] in BODY_METHODS else b""
    headers = alice.signed_headers(e["method"], path, body)
    headers["X-Enclave-Signature"] = b64u(os.urandom(64))
    r = alice.raw_request(e["method"], path, headers, body)
    assert r.status_code == 401, r.text[:200]


@pytest.mark.parametrize("e", DEVICE, ids=endpoint_id)
def test_device_endpoint_refuses_another_devices_key(alice, bob, e):
    """Bob signs a request claiming to be Alice's device."""
    path = fill(e["path"])
    body = b"{}" if e["method"] in BODY_METHODS else b""
    impostor = Device(base_url=alice.base_url, signing_key=bob.signing_key, account_id=alice.account_id, device_id=alice.device_id)
    headers = impostor.signed_headers(e["method"], path, body, nonce=alice._take_nonce())
    r = alice.raw_request(e["method"], path, headers, body)
    assert r.status_code == 401, r.text[:200]


@pytest.mark.parametrize("e", [e for e in DEVICE if e["method"] in BODY_METHODS], ids=endpoint_id)
def test_signed_body_cannot_be_swapped(alice, e):
    path = fill(e["path"], {"accountId": alice.account_id})
    headers = alice.signed_headers(e["method"], path, b'{"a":1}')
    r = alice.raw_request(e["method"], path, headers, b'{"a":2}')
    assert r.status_code == 401, r.text[:200]


@pytest.mark.parametrize("e", [e for e in DEVICE if e["method"] == "GET"], ids=endpoint_id)
def test_signed_path_cannot_be_swapped(alice, e):
    signed_for = fill(e["path"]) + "?signed=1"
    headers = alice.signed_headers("GET", signed_for, b"")
    r = alice.raw_request("GET", fill(e["path"]) + "?signed=2", headers)
    assert r.status_code == 401, r.text[:200]


@pytest.mark.parametrize("e", [e for e in DEVICE if e["method"] == "GET"], ids=endpoint_id)
def test_signed_method_cannot_be_swapped(alice, e):
    path = fill(e["path"])
    headers = alice.signed_headers("DELETE", path, b"")
    r = alice.raw_request("GET", path, headers)
    assert r.status_code in (401, 405), r.text[:200]


@pytest.mark.parametrize("offset_ms,label", [(-120_000, "expired"), (3_600_000, "too long-lived")])
@pytest.mark.parametrize("path", ["/v1/accounts/me", "/v1/devices", "/v1/groups/mine", "/v1/policy"])
def test_signature_lifetime_is_enforced(alice, path, offset_ms, label):
    headers = alice.signed_headers("GET", path, b"", expires=int(time.time() * 1000) + offset_ms)
    assert alice.raw_request("GET", path, headers).status_code == 401, label


@pytest.mark.parametrize("path", ["/v1/accounts/me", "/v1/devices", "/v1/keys/status", "/v1/groups/mine"])
def test_nonce_is_single_use(alice, path):
    nonce = alice._take_nonce()
    first = alice.raw_request("GET", path, alice.signed_headers("GET", path, b"", nonce=nonce))
    assert first.status_code == 200
    replay = alice.raw_request("GET", path, alice.signed_headers("GET", path, b"", nonce=nonce))
    assert replay.status_code == 401 and problem_code(replay) == "NONCE_INVALID"


@pytest.mark.parametrize("path", ["/v1/accounts/me", "/v1/devices", "/v1/keys/status"])
def test_request_id_is_single_use(alice, path):
    request_id = b64u(os.urandom(18))
    assert alice.raw_request("GET", path, alice.signed_headers("GET", path, b"", request_id=request_id)).status_code == 200
    replay = alice.raw_request("GET", path, alice.signed_headers("GET", path, b"", request_id=request_id))
    assert replay.status_code == 401, "a replayed request ID must be refused"


@pytest.mark.parametrize("path", ["/v1/accounts/me", "/v1/devices"])
def test_nonce_of_another_device_is_refused(alice, bob, path):
    stolen = bob._take_nonce()
    r = alice.raw_request("GET", path, alice.signed_headers("GET", path, b"", nonce=stolen))
    assert r.status_code == 401 and problem_code(r) == "NONCE_INVALID"


@pytest.mark.parametrize("value", ["", "x", "A" * 31, "A" * 33, "!" * 32, "../" * 11])
def test_malformed_nonce_is_refused(alice, value):
    r = alice.raw_request("GET", "/v1/accounts/me", alice.signed_headers("GET", "/v1/accounts/me", b"", nonce=value))
    assert r.status_code == 401


@pytest.mark.parametrize("auth", ["EnclaveDevice nonsense", "EnclaveDevice 00000000-0000-0000-0000-000000000000.1", "Bearer abc", "Basic YTpi", "EnclaveDevice "])
def test_malformed_device_authorization_is_refused(alice, auth):
    headers = alice.signed_headers("GET", "/v1/accounts/me", b"")
    headers["Authorization"] = auth
    assert alice.raw_request("GET", "/v1/accounts/me", headers).status_code == 401


def test_revoked_device_is_refused_everywhere(make_device):
    device = make_device("revoked")
    device.signed("DELETE", "/v1/devices/self")
    for path in ["/v1/accounts/me", "/v1/devices", "/v1/keys/status", "/v1/groups/mine", "/v1/policy"]:
        r = device.raw_request("GET", path, device.signed_headers("GET", path, b""))
        assert r.status_code in (401, 403) and problem_code(r) in ("DEVICE_REVOKED", "NONCE_INVALID", "UNAUTHENTICATED"), (path, r.text)


# --- Keycloak-token (account) routes ---------------------------------------------------------------

ACCOUNT_ROUTES = [e for e in ENDPOINTS if kind(e) == "account"]


@pytest.mark.parametrize("e", ACCOUNT_ROUTES, ids=endpoint_id)
@pytest.mark.parametrize("token", [None, "garbage", "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2ln"],
                         ids=["none", "garbage", "alg-none", "hs256-forged"])
def test_account_route_refuses_bad_tokens(alice, e, token):
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    r = alice.raw_request(e["method"], fill(e["path"]), headers, b"{}" if e["method"] in BODY_METHODS else b"")
    assert r.status_code == 401, r.text[:200]


# --- admin routes ------------------------------------------------------------------------------------

@pytest.mark.parametrize("e", ADMIN, ids=endpoint_id)
def test_admin_endpoint_refuses_no_token(alice, e):
    r = alice.raw_request(e["method"], fill(e["path"]), {}, b"{}" if e["method"] in BODY_METHODS else b"")
    assert r.status_code == 401, r.text[:200]


@pytest.fixture(scope="module")
def member_token(kc):
    return kc.user_token(kc.create_user("plainmember"))


@pytest.mark.parametrize("e", ADMIN, ids=endpoint_id)
def test_admin_endpoint_refuses_ordinary_members(alice, member_token, e):
    r = alice.raw_request(e["method"], fill(e["path"]), {"Authorization": f"Bearer {member_token}"}, b"{}" if e["method"] in BODY_METHODS else b"")
    assert r.status_code in (401, 403), r.text[:200]


@pytest.mark.parametrize("e", ADMIN, ids=endpoint_id)
def test_admin_endpoint_refuses_device_signatures(alice, e):
    path = fill(e["path"])
    body = b"{}" if e["method"] in BODY_METHODS else b""
    r = alice.raw_request(e["method"], path, alice.signed_headers(e["method"], path, body), body)
    assert r.status_code == 401, r.text[:200]
