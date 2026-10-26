"""Robustness (OWASP ASVS V5 input validation): no malformed input may produce a server error (5xx).
Every authenticated endpoint gets hostile bodies and path values; anything 5xx is a bug."""
from __future__ import annotations

import json

import pytest

from conftest import device_endpoints, endpoint_id, fill

DEVICE = device_endpoints()
BODY = [e for e in DEVICE if e["method"] in ("POST", "PUT", "PATCH")]

BODIES = {
    "empty": b"",
    "not-json": b"not json",
    "truncated": b'{"a":',
    "array": b"[1,2,3]",
    "null": b"null",
    "number": b"42",
    "string": b'"text"',
    "empty-object": b"{}",
    "wrong-types": json.dumps({k: [] for k in ["destination", "submissionId", "messages", "urgent", "name", "body", "epoch", "message",
                                              "keyId", "publicKey", "kind", "reason", "token", "groupId", "members", "nonces", "ciphertext",
                                              "size", "contentType", "label", "endpoint", "video", "peer"]}).encode(),
    "nulls": json.dumps({k: None for k in ["destination", "submissionId", "messages", "name", "epoch", "message", "groupId", "members"]}).encode(),
    "huge-string": json.dumps({"name": "x" * 300_000, "body": "y" * 300_000}).encode(),
    "deep-nesting": ("[" * 2000 + "]" * 2000).encode(),
    "unicode": json.dumps({"name": "‮\u0000😀" * 50, "label": "￿"}).encode(),
    "negative-numbers": json.dumps({"epoch": -1, "size": -5, "keyId": -1, "deviceId": -1, "limit": -1}).encode(),
    "huge-numbers": json.dumps({"epoch": 2**70, "size": 10**30, "keyId": 2**63, "registrationId": 2**40}).encode(),
}


@pytest.mark.parametrize("label", list(BODIES), ids=list(BODIES))
@pytest.mark.parametrize("e", BODY, ids=endpoint_id)
def test_hostile_bodies_never_cause_server_errors(alice, e, label):
    path = fill(e["path"], {"accountId": alice.account_id})
    body = BODIES[label]
    r = alice.raw_request(e["method"], path, alice.signed_headers(e["method"], path, body), body)
    assert r.status_code < 500, f"{r.status_code}: {r.text[:300]}"


PATH_VALUES = {
    "sql": "1' OR '1'='1",
    "traversal": "..%2F..%2Fetc%2Fpasswd",
    "long": "a" * 4000,
    "unicode": "%E2%80%AE%F0%9F%98%80",
    "negative": "-1",
    "zero": "0",
    "overflow": "99999999999999999999999",
    "empty-ish": "%20",
}


@pytest.mark.parametrize("label", list(PATH_VALUES), ids=list(PATH_VALUES))
@pytest.mark.parametrize("e", [e for e in DEVICE if "{" in e["path"]], ids=endpoint_id)
def test_hostile_path_values_never_cause_server_errors(alice, e, label):
    value = PATH_VALUES[label]
    path = fill(e["path"], {k: value for k in ["accountId", "deviceId", "groupId", "communityId", "attachmentId", "callId", "id", "guid", "token",
                                                "submissionId", "provisioningId"]})
    body = b"{}" if e["method"] in ("POST", "PUT", "PATCH") else b""
    r = alice.raw_request(e["method"], path, alice.signed_headers(e["method"], path, body), body)
    assert r.status_code < 500, f"{r.status_code}: {r.text[:300]}"


QUERIES = ["?q=%27%3B--", "?limit=-1", "?limit=999999999", "?after=-5", "?fromEpoch=abc", "?since=99999999999", "?from=5&to=1", "?q=" + "z" * 3000]


@pytest.mark.parametrize("query", QUERIES)
@pytest.mark.parametrize("e", [e for e in DEVICE if e["method"] == "GET"], ids=endpoint_id)
def test_hostile_query_strings_never_cause_server_errors(alice, e, query):
    path = fill(e["path"], {"accountId": alice.account_id}) + query
    r = alice.raw_request("GET", path, alice.signed_headers("GET", path, b""))
    assert r.status_code < 500, f"{r.status_code}: {r.text[:300]}"
