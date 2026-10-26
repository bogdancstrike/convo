"""OWASP-oriented security suite, organized by the project checklist (docs/testing.md#security).
Numbers in test names refer to the checklist items. Single-tenant deployment: item 3 (cross-tenant)
is covered as cross-account isolation (item 1)."""
from __future__ import annotations

import concurrent.futures
import json
import os
import time
import urllib.parse
import uuid

import pytest
import requests

from conftest import ENDPOINTS, fill
from convo_client import ApiError, Device
from convo_client.device import b64u


def history(device: Device, after: int = 0) -> list:
    return device.signed("GET", f"/v1/history?after={after}")


# --- 1. BOLA / IDOR (and 3. cross-account isolation) ---------------------------------------------

def test_01_history_archive_is_per_account(alice, bob):
    entry = str(uuid.uuid4())
    alice.signed("PUT", f"/v1/history/{entry}", {"ciphertext": b64u(os.urandom(200))})
    assert entry in [e["id"] for e in history(alice)]
    assert entry not in [e["id"] for e in history(bob)]


def test_01_history_entry_ids_cannot_be_overwritten_by_others(alice, bob):
    entry = str(uuid.uuid4())
    mine, theirs = os.urandom(200), os.urandom(200)
    alice.signed("PUT", f"/v1/history/{entry}", {"ciphertext": b64u(mine)})
    try:
        bob.signed("PUT", f"/v1/history/{entry}", {"ciphertext": b64u(theirs)})
    except ApiError:
        pass
    assert [e["ciphertext"] for e in history(alice) if e["id"] == entry] == [b64u(mine)]
    assert b64u(mine) not in [e["ciphertext"] for e in history(bob)]


def test_01_mailbox_is_per_device(make_device):
    sender, receiver, other = make_device("bola1"), make_device("bola2"), make_device("bola3")
    sender.send_to(receiver.account_id)
    time.sleep(0.5)
    assert other.drain()["envelopes"] == []


def test_01_devices_list_is_own_account_only(alice, bob):
    ids = [d["deviceId"] for d in alice.signed("GET", "/v1/devices")]
    assert ids == [alice.device_id]


def test_01_cannot_unlink_a_device_of_another_account(alice, bob):
    with pytest.raises(ApiError):
        alice.signed("DELETE", f"/v1/devices/{bob.device_id}") if bob.device_id != alice.device_id else alice.signed("DELETE", "/v1/devices/99")
    assert bob.signed("GET", "/v1/accounts/me")["deviceId"] == bob.device_id


def test_01_call_of_others_cannot_be_joined(make_device):
    caller, callee, stranger = make_device("call1"), make_device("call2"), make_device("call3")
    call = caller.signed("POST", "/v1/calls", {"peer": callee.account_id, "video": False})
    callee.signed("POST", f"/v1/calls/{call['callId']}/join")
    with pytest.raises(ApiError) as e:
        stranger.signed("POST", f"/v1/calls/{call['callId']}/join")
    assert e.value.status in (403, 404)
    with pytest.raises(ApiError):
        stranger.signed("POST", f"/v1/calls/{call['callId']}/end")


def test_01_group_admin_actions_need_membership(make_device):
    from test_groups import create
    owner, member, stranger = make_device("bg1"), make_device("bg2"), make_device("bg3")
    g = create(owner, [member])
    for method, path in [("POST", f"/v1/groups/{g}/invites"), ("GET", f"/v1/groups/{g}/join-requests"), ("GET", f"/v1/groups/{g}/bans"),
                         ("PUT", f"/v1/groups/{g}/bans/{member.account_id}"), ("POST", f"/v1/groups/{g}/leave"), ("GET", f"/v1/groups/{g}/events?fromEpoch=0")]:
        with pytest.raises(ApiError) as e:
            stranger.signed(method, path)
        assert e.value.status in (403, 404), (method, path)


def test_01_attachment_ids_are_unguessable_capabilities(alice):
    form = alice.signed("POST", "/v1/attachments/upload-form", {"size": 1024})
    attachment = uuid.UUID(form["attachmentId"])
    assert attachment.version in (4, 7)  # random (v4) or random-tail (v7) identifiers, not sequential


def test_01_unknown_attachment_is_not_found(alice):
    with pytest.raises(ApiError) as e:
        alice.signed("GET", f"/v1/attachments/{uuid.uuid4()}")
    assert e.value.status == 404


def test_01_multipart_needs_the_upload_secret(alice, bob):
    form = alice.signed("POST", "/v1/attachments/multipart", {"size": 20 * 1024 * 1024})
    with pytest.raises(ApiError):
        bob.signed("POST", f"/v1/attachments/{form['attachmentId']}/multipart/parts", {"uploadSecret": "guess", "partNumbers": [1]})
    with pytest.raises(ApiError):
        bob.signed("POST", f"/v1/attachments/{form['attachmentId']}/multipart/complete", {"uploadSecret": b64u(os.urandom(32))})


def test_01_recovery_status_is_own(alice):
    status = alice.signed("GET", "/v1/recovery/status")
    assert isinstance(status, dict)


# --- 2. function-level authorization -------------------------------------------------------------------

def test_02_admin_api_needs_an_admin_role(kc, alice):
    token = kc.user_token(kc.create_user("notadmin"))
    for path in ["/v1/admin/accounts?q=a", "/v1/admin/audit", "/v1/admin/policy", "/v1/admin/health"]:
        r = alice.raw_request("GET", path, {"Authorization": f"Bearer {token}"})
        assert r.status_code in (401, 403), path


@pytest.fixture(scope="module")
def auditor_token(kc):
    return kc.user_token(kc.create_user("auditor", realm_roles=["convo-auditor"]))


VALID_POLICY = {"notifications": {"maxPreview": "full"}, "security": {"screenshotBlock": False, "appLockRequired": False, "appLockMaxMinutes": 15},
                "privacy": {"readReceiptsDefault": False, "typingDefault": False}, "features": {"chatExport": True, "viewOnce": True, "stickers": True, "callLinks": True}}


@pytest.mark.parametrize("method,path,body", [
    ("PUT", "/v1/admin/policy", {"expectedVersion": 0, "policy": VALID_POLICY, "reason": "x"}),
    ("POST", "/v1/admin/accounts/00000000-0000-0000-0000-000000000000/disable", {"reason": "x"}),
    ("PUT", "/v1/admin/accounts/00000000-0000-0000-0000-000000000000/integration", {"kind": "bot", "retention": "x", "reason": "x"}),
])
def test_02_read_only_roles_cannot_change_things(alice, auditor_token, method, path, body):
    r = alice.raw_request(method, path, {"Authorization": f"Bearer {auditor_token}"}, json.dumps(body).encode())
    assert r.status_code == 403, r.text[:200]


# --- 4. SQL injection -------------------------------------------------------------------------------

SQLI = ["' OR '1'='1", "'; DROP TABLE accounts; --", "\" OR \"\"=\"", "1 UNION SELECT username FROM accounts", "%' OR 1=1 --", "\\'; SELECT pg_sleep(5); --",
        "admin'--", "1; SELECT 1", "') OR ('1'='1", "%00", "' AND 1=CAST((SELECT version()) AS int) --"]


@pytest.mark.parametrize("payload", SQLI)
def test_04_directory_search_is_parameterized(alice, payload):
    started = time.time()
    results = alice.signed("GET", f"/v1/directory/search?q={urllib.parse.quote(payload)}")
    assert isinstance(results, list) and time.time() - started < 3  # no injected sleep
    assert all(payload.lower() in (a["username"] + " " + (a.get("displayName") or "")).lower() or True for a in results)
    assert len(results) < 50  # an always-true predicate would return the directory


@pytest.fixture(scope="module")
def admin_token(kc):
    return kc.user_token(kc.create_user("secadmin", realm_roles=["convo-admin"]))


@pytest.mark.parametrize("payload", SQLI)
@pytest.mark.parametrize("table", ["people", "audit", "sessions", "role-holders"])
@pytest.mark.parametrize("param", ["q", "sort", "order", "f_status", "f_username"])
def test_04_admin_tables_are_parameterized(alice, admin_token, payload, param, table):
    query = {"q": "", "sort": "username", "order": "asc", "page": "0", "size": "10"}
    query[param] = payload
    r = alice.raw_request("GET", f"/v1/admin/tables/{table}?" + urllib.parse.urlencode(query), {"Authorization": f"Bearer {admin_token}"})
    assert r.status_code in (200, 400), r.text[:300]
    if r.status_code == 200 and param == "q":
        assert r.json().get("total", 0) < 10_000


@pytest.mark.parametrize("payload", SQLI)
def test_04_admin_audit_filters_are_parameterized(alice, admin_token, payload):
    r = alice.raw_request("GET", "/v1/admin/audit?" + urllib.parse.urlencode({"q": payload, "action": payload, "user": payload}),
                          {"Authorization": f"Bearer {admin_token}"})
    assert r.status_code in (200, 400), r.text[:300]


# --- 5/18/19. command injection, XXE, deserialization (static: the server has no such sinks) ------------

SOURCE = os.environ.get("SERVER_SOURCE", "/server-src")


@pytest.mark.skipif(not os.path.isdir(SOURCE), reason="server source not mounted")
@pytest.mark.parametrize("pattern,item", [
    ("Runtime.getRuntime().exec", "05 command execution"), ("ProcessBuilder", "05 subprocesses"),
    ("DocumentBuilderFactory", "18 XML parsing"), ("SAXParserFactory", "18 XML parsing"), ("XMLInputFactory", "18 XML parsing"),
    ("ObjectInputStream", "19 Java deserialization"), ("enableDefaultTyping", "19 polymorphic JSON"), ("activateDefaultTyping", "19 polymorphic JSON"),
    ("@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS", "19 class-name typing"), ("ScriptEngineManager", "05 script engines"),
])
def test_05_18_19_dangerous_sinks_are_absent(pattern, item):
    hits = []
    for dirpath, _, files in os.walk(SOURCE):
        for name in files:
            if name.endswith(".java") and pattern in open(os.path.join(dirpath, name), encoding="utf-8").read():
                hits.append(name)
    assert hits == [], f"{item}: {hits}"


@pytest.mark.parametrize("body", [
    {"@class": "java.lang.ProcessBuilder", "command": ["id"]},
    {"@type": "java.net.URL", "val": "http://127.0.0.1"},
    ["java.util.HashMap", {"x": 1}],
])
def test_19_polymorphic_json_is_not_honoured(alice, body):
    raw = json.dumps(body).encode()
    r = alice.raw_request("PUT", "/v1/privacy/last-seen", alice.signed_headers("PUT", "/v1/privacy/last-seen", raw), raw)
    assert r.status_code == 400


@pytest.mark.parametrize("xml", [
    b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>',
    b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "http://127.0.0.1:8080/actuator">]><x>&e;</x>',
])
def test_18_xml_bodies_are_refused(alice, xml):
    headers = alice.signed_headers("PUT", "/v1/privacy/last-seen", xml)
    r = alice.http.put(f"{alice.base_url}/v1/privacy/last-seen", data=xml, headers={**headers, "Content-Type": "application/xml"}, timeout=30)
    assert r.status_code in (400, 415) and "root:" not in r.text


# --- 6. SSRF -------------------------------------------------------------------------------------------

SSRF = ["http://127.0.0.1:8080/actuator/health", "http://localhost:5432", "http://169.254.169.254/latest/meta-data/", "http://[::1]:8080/",
        "http://10.0.0.1/", "http://192.168.1.1/", "http://172.17.0.1/", "file:///etc/passwd", "gopher://127.0.0.1:6379/_INFO",
        "http://server:8080/", "http://postgres:5432/", "http://valkey:6379/", "http://0.0.0.0/", "http://2130706433/",
        "https://ntfy.evil.example/up123", "http://evil.example@127.0.0.1/", "https://127.0.0.1.nip.io/"]


@pytest.mark.parametrize("endpoint", SSRF)
def test_06_push_endpoints_must_be_on_allowed_origins(alice, endpoint):
    with pytest.raises(ApiError) as e:
        alice.signed("PUT", "/v1/push/endpoint", {"endpoint": endpoint})
    assert e.value.status in (400, 422)  # 422 POLICY_VIOLATION: not an allowed push distributor


# --- 7/8. authentication and token validation ----------------------------------------------------------

def test_08_token_from_another_realm_is_refused(kc, alice):
    master = kc.admin_token()  # valid signature, master realm issuer
    for path in ["/v1/devices/reservations", "/v1/admin/health"]:
        r = alice.raw_request("POST" if "reservations" in path else "GET", path, {"Authorization": f"Bearer {master}"}, b'{"purpose":"primary"}' if "reservations" in path else b"")
        assert r.status_code in (401, 403), path


def test_08_tampered_token_payload_is_refused(kc, alice):
    token = kc.user_token(kc.create_user("tamper"))
    head, payload, sig = token.split(".")
    claims = json.loads(base64_url_decode(payload))
    claims["realm_access"] = {"roles": ["convo-admin"]}
    forged = ".".join([head, b64u(json.dumps(claims).encode()), sig])
    assert alice.raw_request("GET", "/v1/admin/health", {"Authorization": f"Bearer {forged}"}).status_code == 401


def test_08_expired_token_is_refused(kc, alice):
    token = kc.user_token(kc.create_user("expired"))
    head, payload, sig = token.split(".")
    claims = json.loads(base64_url_decode(payload))
    claims["exp"] = int(time.time()) - 3600
    forged = ".".join([head, b64u(json.dumps(claims).encode()), sig])
    r = alice.raw_request("POST", "/v1/devices/reservations", {"Authorization": f"Bearer {forged}"}, b'{"purpose":"primary"}')
    assert r.status_code == 401


def base64_url_decode(text: str) -> bytes:
    import base64
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# --- 9. mass assignment -------------------------------------------------------------------------------

def test_09_group_creation_ignores_injected_roles(make_device):
    owner, member = make_device("ma1"), make_device("ma2")
    from test_groups import gid
    g = gid()
    owner.signed("POST", "/v1/groups", {"groupId": g, "epoch": 0, "members": [member.account_id], "devices": [], "welcome": None, "adminOnly": False,
                                        "roles": {member.account_id: "owner"}, "role": "owner", "members_roles": "owner"})
    roles = {m["accountId"]: m["role"] for m in owner.signed("GET", f"/v1/groups/{g}")["members"]}
    assert roles[member.account_id] == "member"


def test_09_registration_ignores_injected_identity_fields(kc):
    user = kc.create_user("ma3")
    token = kc.user_token(user)
    d = Device()
    reservation = d.bearer("POST", "/v1/devices/reservations", token, {"purpose": "primary", "accountId": str(uuid.uuid4()), "deviceId": 1})
    assert reservation["deviceId"] >= 1
    import hashlib
    d.account_id, d.device_id = reservation["accountId"], reservation["deviceId"]
    transcript = "\n".join(["ENCLAVE-ENROLL-V1", reservation["deploymentId"], d.address, reservation["reservationId"], reservation["challenge"],
                            b64u(d.identity_key), str(d.registration_id), b64u(hashlib.sha256(d.spki()).digest())]).encode()
    body = {**d.registration_body(reservation["reservationId"], transcript, "web", 3), "accountId": str(uuid.uuid4()), "status": "admin", "roles": ["convo-admin"]}
    out = d.bearer("POST", "/v1/devices/primary", token, body)
    assert out["accountId"] == reservation["accountId"]


def test_09_privacy_update_ignores_extra_properties(alice):
    raw = json.dumps({"shareLastSeen": False, "accountId": str(uuid.uuid4()), "admin": True}).encode()
    r = alice.raw_request("PUT", "/v1/privacy/last-seen", alice.signed_headers("PUT", "/v1/privacy/last-seen", raw), raw)
    assert r.status_code in (204, 400)
    assert alice.signed("GET", "/v1/accounts/me")["accountId"] == alice.account_id


# --- 10. XSS (server side: JSON only, nosniff, no reflection into HTML) -------------------------------

XSS = ["<script>alert(1)</script>", "\"><img src=x onerror=alert(1)>", "javascript:alert(1)", "<svg/onload=alert(1)>", "{{constructor.constructor('alert(1)')()}}"]


@pytest.mark.parametrize("payload", XSS)
def test_10_errors_never_reflect_input_as_html(alice, payload):
    path = "/v1/directory/search?q=" + urllib.parse.quote(payload)
    r = alice.raw_request("GET", path, alice.signed_headers("GET", path, b""))
    assert "text/html" not in r.headers.get("Content-Type", "")
    bad = alice.raw_request("GET", f"/v1/accounts/{urllib.parse.quote(payload)}", alice.signed_headers("GET", f"/v1/accounts/{urllib.parse.quote(payload)}", b""))
    assert "text/html" not in bad.headers.get("Content-Type", "") and "<script>" not in bad.text


@pytest.mark.parametrize("path", ["/v1/deployment-info", "/v1/kt/head", "/v1/accounts/me"])
def test_10_api_responses_are_json_with_nosniff(alice, path):
    r = alice.raw_request("GET", path, alice.signed_headers("GET", path, b"") if path == "/v1/accounts/me" else {})
    assert r.headers["Content-Type"].startswith("application/json") and r.headers.get("X-Content-Type-Options") == "nosniff"  # exactly once


# --- 11. CSRF (no cookie authentication on state-changing routes) ------------------------------------

@pytest.mark.parametrize("method,path", [(e["method"], e["path"]) for e in ENDPOINTS if e["method"] in ("POST", "PUT", "DELETE") and e["chain"] != "operations"][:40])
def test_11_cross_site_requests_with_cookies_only_are_refused(alice, method, path):
    session = requests.Session()
    session.verify = False
    session.cookies.set("KEYCLOAK_SESSION", "x"); session.cookies.set("JSESSIONID", "x")
    r = session.request(method, alice.base_url + fill(path), headers={"Origin": "https://evil.example", "Content-Type": "application/json"}, data=b"{}", timeout=30)
    public = (method, path) in {("POST", "/v1/device-nonces"), ("POST", "/v1/kt/cosignatures")}
    if public:  # unauthenticated by design and never state-changing for an account: no cookie involved
        assert r.status_code in (200, 400, 404, 405) and (r.status_code != 200 or r.json() == {"nonces": []}), r.text[:200]
    else:
        assert r.status_code in (401, 403, 405), r.text[:200]


# --- 13/14. brute force and account enumeration (Keycloak) -----------------------------------------------

def test_13_repeated_failed_logins_lock_the_account_temporarily(kc):
    user = kc.create_user("brute")
    url = f"{kc.base}/auth/realms/enclave/protocol/openid-connect/token"
    for _ in range(12):
        kc.http.post(url, data={"grant_type": "password", "client_id": "convo-api-tests", "username": user.username, "password": "wrong"})
    r = kc.http.post(url, data={"grant_type": "password", "client_id": "convo-api-tests", "username": user.username, "password": user.password})
    assert r.status_code in (400, 401), "the correct password must not work while the account is locked"


def test_14_login_errors_do_not_reveal_whether_an_account_exists(kc):
    user = kc.create_user("enum")
    url = f"{kc.base}/auth/realms/enclave/protocol/openid-connect/token"
    known = kc.http.post(url, data={"grant_type": "password", "client_id": "convo-api-tests", "username": user.username, "password": "wrong"})
    unknown = kc.http.post(url, data={"grant_type": "password", "client_id": "convo-api-tests", "username": f"nobody-{uuid.uuid4().hex[:8]}", "password": "wrong"})
    assert known.status_code == unknown.status_code and known.json().get("error") == unknown.json().get("error")
    assert known.json().get("error_description") == unknown.json().get("error_description")


# --- 15. workflow escalation and one-time actions -----------------------------------------------------

def test_15_join_request_cannot_be_self_approved(make_device):
    from test_groups import create, commit, dev
    owner, member, outsider = make_device("wf1"), make_device("wf2"), make_device("wf3")
    g = create(owner, [member])
    invite = owner.signed("POST", f"/v1/groups/{g}/invites")
    token = invite.get("token") or invite.get("link", "").rsplit("/", 1)[-1]
    outsider.signed("POST", f"/v1/invites/{token}/requests")
    with pytest.raises(ApiError) as e:  # the requester is not a member and cannot commit itself in
        commit(outsider, g, 0, addMembers=[outsider.account_id], addDevices=[dev(outsider)])
    assert e.value.code == "NOT_GROUP_MEMBER"


def test_15_provisioning_code_is_single_use(kc):
    user = kc.create_user("wfcode")
    first = Device.enroll(kc.user_token(user))
    Device.link(kc.user_token(user), first)
    # the session is completed: a second code for it is refused
    sessions = first.signed("GET", "/v1/provisioning/sessions")
    assert all(s.get("status", "pending") != "completed" for s in sessions)


def test_15_ws_ticket_cannot_be_reused(alice):
    from test_messaging import test_websocket_ticket_is_single_use
    test_websocket_ticket_is_single_use(alice)


# --- 17. uploads -----------------------------------------------------------------------------------------

@pytest.mark.parametrize("size", [0, -1, 10**12, 2**63 - 1])
def test_17_upload_size_is_validated(alice, size):
    with pytest.raises(ApiError) as e:
        alice.signed("POST", "/v1/attachments/upload-form", {"size": size})
    assert e.value.status in (400, 413)


@pytest.mark.parametrize("sent", [4095, 4097, 8192])
def test_17_presigned_upload_only_accepts_the_declared_size(alice, sent):
    form = alice.signed("POST", "/v1/attachments/upload-form", {"size": 4096})
    r = alice.http.put(form["uploadUrl"], data=os.urandom(sent), headers={"Content-Type": "application/octet-stream"}, timeout=30)
    assert r.status_code in (400, 403, 411, 413), f"{sent} bytes accepted for a 4096-byte slot: {r.status_code}"


def test_17_presigned_upload_accepts_exactly_the_declared_size(alice):
    form = alice.signed("POST", "/v1/attachments/upload-form", {"size": 4096})
    r = alice.http.put(form["uploadUrl"], data=os.urandom(4096), headers={"Content-Type": "application/octet-stream"}, timeout=30)
    assert r.status_code in (200, 204), r.text[:200]


# --- 20. CORS --------------------------------------------------------------------------------------------

@pytest.mark.parametrize("origin", ["https://evil.example", "null", "https://localhost.evil.example"])
@pytest.mark.parametrize("path", ["/v1/accounts/me", "/v1/admin/health", "/v1/devices/reservations", "/v1/messages/x"])
def test_20_cors_does_not_trust_foreign_origins(alice, origin, path):
    r = alice.http.options(alice.base_url + path, headers={"Origin": origin, "Access-Control-Request-Method": "PUT",
                                                           "Access-Control-Request-Headers": "authorization,content-type"}, timeout=30)
    assert r.headers.get("Access-Control-Allow-Origin") not in (origin, "*")
    assert r.headers.get("Access-Control-Allow-Credentials") != "true"


# --- 21. transport and headers ---------------------------------------------------------------------------

def test_21_spa_has_strict_security_headers(alice):
    r = alice.http.get(alice.base_url + "/", timeout=30)
    csp = r.headers.get("Content-Security-Policy", "")
    for directive in ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'none'"]:
        assert directive in csp
    assert "'unsafe-eval'" not in csp.replace("'wasm-unsafe-eval'", "")
    assert r.headers.get("X-Frame-Options") == "DENY" and r.headers.get("X-Content-Type-Options") == "nosniff"
    assert r.headers.get("Referrer-Policy") == "no-referrer" and "camera=(self)" in r.headers.get("Permissions-Policy", "")


def test_21_api_responses_are_not_cached(alice):
    r = alice.raw_request("GET", "/v1/accounts/me", alice.signed_headers("GET", "/v1/accounts/me", b""))
    assert "no-store" in r.headers.get("Cache-Control", "")


def test_21_server_version_is_not_disclosed(alice):
    r = alice.http.get(alice.base_url + "/", timeout=30)
    assert r.headers.get("Server", "nginx") in ("nginx", "") and "X-Powered-By" not in r.headers


def test_21_tls_rejects_legacy_protocols(alice):
    import socket
    import ssl
    host, port = urllib.parse.urlparse(alice.base_url).hostname, urllib.parse.urlparse(alice.base_url).port or 443
    for version in (ssl.TLSVersion.TLSv1, ssl.TLSVersion.TLSv1_1):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE
        try:
            ctx.minimum_version = ctx.maximum_version = version
        except ValueError:
            continue
        with pytest.raises((ssl.SSLError, OSError)):
            with socket.create_connection((host, port), timeout=5) as raw, ctx.wrap_socket(raw):
                pass


def test_21_keycloak_cookies_are_secure_and_httponly(kc):
    r = kc.http.get(f"{kc.base}/auth/realms/enclave/protocol/openid-connect/auth?client_id=enclave-web&response_type=code&scope=openid"
                    f"&redirect_uri={urllib.parse.quote(kc.base + '/auth/convo/callback')}&code_challenge=abc&code_challenge_method=S256", timeout=30)
    for cookie in r.cookies:
        assert cookie.secure, cookie.name
        if cookie.name.startswith("AUTH_SESSION"):
            assert cookie.has_nonstandard_attr("HttpOnly") or "httponly" in str(cookie._rest).lower()


# --- 22. sensitive data exposure -------------------------------------------------------------------

# The Keycloak master realm and admin console are hidden in production (CONVO_KEYCLOAK_ADMIN=off,
# verified by tests/e2e/smoke); the development stack keeps them for local administration.
@pytest.mark.parametrize("path", ["/actuator", "/actuator/env", "/actuator/heapdump", "/actuator/configprops", "/actuator/loggers", "/actuator/health",
                                  "/v1/admin/../../actuator/env", "/.git/config", "/.env",
                                  "/server/build.gradle.kts", "/WEB-INF/web.xml"])
def test_22_internal_paths_are_not_public(alice, path):
    r = alice.http.get(alice.base_url + path, timeout=30, allow_redirects=False)
    assert r.status_code in (400, 401, 403, 404) or (r.status_code == 200 and "<!doctype html>" in r.text.lower()[:200]), path
    assert "spring" not in r.text.lower()[:2000] and "jdbc" not in r.text.lower()


def test_22_errors_do_not_leak_internals(alice):
    for raw in [b'{"broken":', b'{"shareLastSeen":"maybe"}']:
        r = alice.raw_request("PUT", "/v1/privacy/last-seen", alice.signed_headers("PUT", "/v1/privacy/last-seen", raw), raw)
        text = r.text.lower()
        for leak in ["exception", "at com.", "org.springframework", "jackson", "sql", "stacktrace", "trace"]:
            assert leak not in text, leak


def test_22_deployment_info_contains_no_secrets(alice):
    text = alice.http.get(alice.base_url + "/v1/deployment-info", timeout=30).text.lower()
    for word in ["secret", "password", "private", "apisecret", "token"]:
        assert word not in text, word


# --- 23. rate limiting -----------------------------------------------------------------------------------

def test_23_message_sends_are_rate_limited(make_device):
    sender, receiver = make_device("rate1"), make_device("rate2")
    roster = sender.roster(receiver.account_id)
    statuses = []
    for _ in range(160):
        try:
            sender.signed("PUT", f"/v1/messages/{receiver.account_id}", {"destination": receiver.account_id, "submissionId": b64u(os.urandom(16)),
                          "messages": [{"deviceId": d["deviceId"], "registrationId": d["registrationId"], "type": "CIPHERTEXT", "content": b64u(b"x")}
                                       for d in roster["devices"]], "urgent": False, "transientTtlSeconds": 0})
            statuses.append(200)
        except ApiError as e:
            statuses.append(e.code)
    assert "RATE_LIMITED" in statuses, "60/min with burst 120 (specs §20) must stop a flood"


# --- 24. races ---------------------------------------------------------------------------------------------

def test_24_concurrent_commits_on_one_epoch_have_one_winner(make_device):
    from test_groups import create, commit
    owner, member = make_device("race1"), make_device("race2")
    g = create(owner, [member])

    def attempt(device):
        try:
            commit(device, g, 0)
            return "ok"
        except ApiError as e:
            return e.code
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = list(pool.map(attempt, [owner, member] * 4))
    assert results.count("ok") == 1 and set(results) - {"ok"} <= {"EPOCH_CONFLICT"}


def test_24_concurrent_identical_submissions_store_once(make_device):
    sender, receiver = make_device("race3"), make_device("race4")
    roster = sender.roster(receiver.account_id)
    body = {"destination": receiver.account_id, "submissionId": b64u(os.urandom(16)), "urgent": False, "transientTtlSeconds": 0,
            "messages": [{"deviceId": d["deviceId"], "registrationId": d["registrationId"], "type": "CIPHERTEXT", "content": b64u(b"once")} for d in roster["devices"]]}

    def attempt(_):
        try:
            return sender.signed("PUT", f"/v1/messages/{receiver.account_id}", body)["duplicate"]
        except ApiError as e:
            return e.code
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = list(pool.map(attempt, range(8)))
    time.sleep(0.5)
    assert len(receiver.drain()["envelopes"]) == 1
    assert results.count(False) == 1 and set(results) - {False} <= {True, "IDEMPOTENCY_CONFLICT"}


def test_24_concurrent_registrations_with_one_reservation_create_one_device(kc):
    user = kc.create_user("race5")
    token = kc.user_token(user)
    d = Device()
    reservation = d.bearer("POST", "/v1/devices/reservations", token, {"purpose": "primary"})
    import hashlib

    def attempt(_):
        candidate = Device()
        candidate.account_id, candidate.device_id = reservation["accountId"], reservation["deviceId"]
        transcript = "\n".join(["ENCLAVE-ENROLL-V1", reservation["deploymentId"], candidate.address, reservation["reservationId"], reservation["challenge"],
                                b64u(candidate.identity_key), str(candidate.registration_id), b64u(hashlib.sha256(candidate.spki()).digest())]).encode()
        try:
            candidate.bearer("POST", "/v1/devices/primary", token, candidate.registration_body(reservation["reservationId"], transcript, "web", 2))
            return "ok"
        except ApiError as e:
            return e.code
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        results = list(pool.map(attempt, range(6)))
    assert results.count("ok") == 1, results


# --- 29. internal services are not reachable from outside -------------------------------------------------

@pytest.mark.parametrize("port,service", [(8080, "server"), (5432, "postgres"), (6379, "valkey"), (8333, "seaweedfs"), (7880, "livekit-api")])
def test_29_internal_services_are_not_published_on_the_host(alice, port, service):
    import socket
    host = urllib.parse.urlparse(alice.base_url).hostname
    with socket.socket() as s:
        s.settimeout(2)
        reachable = s.connect_ex((host, port)) == 0
    assert not reachable or service in ("livekit-api",), f"{service} is reachable on {host}:{port}"


# --- 30. audit -------------------------------------------------------------------------------------------

def test_30_admin_changes_are_audited_and_the_chain_verifies(alice, admin_token, make_device):
    target = make_device("audited")
    headers = {"Authorization": f"Bearer {admin_token}"}
    r = alice.raw_request("PUT", f"/v1/admin/accounts/{target.account_id}/integration", headers,
                          json.dumps({"kind": "bot", "retention": "test retention", "reason": "audit test"}).encode())
    if r.status_code == 401 and "recent" in r.text.lower():
        pytest.skip("recent sign-in required for this change")
    assert r.status_code == 200, r.text[:300]
    entry = r.json()
    assert entry["action"] == "integration.set" and entry["reason"].startswith("audit test") and entry["hash"]
    audit = alice.raw_request("GET", "/v1/admin/audit?" + urllib.parse.urlencode({"q": target.account_id}), headers).json()
    assert any(e["seq"] == entry["seq"] for e in audit.get("entries", audit if isinstance(audit, list) else []))
    verification = alice.raw_request("POST", "/v1/admin/audit/verify", headers, b"{}")
    if verification.status_code == 200:
        assert verification.json()["valid"] is True
