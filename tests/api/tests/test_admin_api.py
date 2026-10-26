"""Admin console API, functionally: every console endpoint does what the console relies on.

Security of these endpoints (roles, tokens, device signatures, injection) is covered by
test_security_auth.py and test_owasp.py; here an organization admin with a fresh sign-in uses them.
Every change carries a reason and must appear in the audit chain.
"""
import os
import time

import pytest
import requests
import urllib3

urllib3.disable_warnings()
BASE = os.environ.get("BASE_URL", "https://localhost:8443")


class Admin:
    """A signed-in console session (bearer token, like the admin web app)."""

    def __init__(self, token: str):
        self.http = requests.Session()
        self.http.verify = False
        self.http.headers["Authorization"] = f"Bearer {token}"

    def call(self, method: str, path: str, json=None, params=None) -> requests.Response:
        return self.http.request(method, f"{BASE}/v1/admin{path}", json=json, params=params, timeout=30)

    def ok(self, method: str, path: str, json=None, params=None):
        r = self.call(method, path, json, params)
        assert r.status_code == 200, f"{method} {path}: {r.status_code} {r.text[:300]}"
        return r.json() if r.content else None


@pytest.fixture(scope="module")
def admin(kc) -> Admin:
    return Admin(kc.user_token_interactive(kc.create_user("funcadmin", realm_roles=["convo-admin"])))


@pytest.fixture(scope="module")
def target(make_device):
    """An ordinary member with one enrolled device."""
    return make_device("target")


def status(device, method: str = "GET", path: str = "/v1/accounts/me") -> int:
    """HTTP status of a device-signed request (the client raises on errors)."""
    from convo_client.device import ApiError
    try:
        device.signed(method, path)
        return 200
    except ApiError as e:
        return e.status


def audited(admin: Admin, action: str, reason: str) -> bool:
    entries = admin.ok("GET", "/audit", params={"limit": 100, "q": reason})
    return any(e["action"] == action and reason in e["reason"] for e in entries)


def table(admin: Admin, name: str, **params):
    query = {"q": "", "sort": "", "order": "asc", "page": "1", "size": "25", **params}
    page = admin.ok("GET", f"/tables/{name}", params=query)
    assert {"rows", "total", "page", "size", "warnings"} <= set(page)
    return page


# --- who am I -----------------------------------------------------------------------------------

def test_me_lists_roles_and_permissions(admin):
    me = admin.ok("GET", "/me")
    assert "convo-admin" in me["roles"]
    assert {"ACCOUNTS_READ", "AUDIT_READ", "POLICY_MANAGE"} <= set(me["permissions"])


# --- accounts and devices -----------------------------------------------------------------------

def test_account_search_and_detail(admin, target):
    found = admin.ok("GET", "/accounts", params={"q": target.user.username, "limit": 200})
    assert [a["accountId"] for a in found] == [target.account_id]
    account = admin.ok("GET", f"/accounts/{target.account_id}")
    assert account["username"] == target.user.username and account["status"] == "active" and account["activeDevices"] == 1


def test_devices_of_an_account(admin, target):
    devices = admin.ok("GET", f"/accounts/{target.account_id}/devices")
    assert [d["deviceId"] for d in devices] == [target.device_id]


def test_unknown_account_is_404(admin):
    assert admin.call("GET", "/accounts/00000000-0000-4000-8000-0000000000ff").status_code == 404


def test_disable_and_enable_are_audited(admin, make_device):
    member = make_device("toggle")
    reason = f"review {member.user.username}"
    admin.ok("POST", f"/accounts/{member.account_id}/disable", {"reason": reason})
    assert admin.ok("GET", f"/accounts/{member.account_id}")["status"] == "disabled"
    # A disabled account's device is refused, but keeps its keys (it comes back on enable).
    assert status(member) == 403
    admin.ok("POST", f"/accounts/{member.account_id}/enable", {"reason": reason + " closed"})
    assert status(member) == 200
    assert audited(admin, "account.disable", reason) and audited(admin, "account.enable", reason + " closed")


def test_changes_need_a_reason(admin, target):
    r = admin.call("POST", f"/accounts/{target.account_id}/disable", {"reason": ""})
    assert r.status_code == 400
    assert admin.ok("GET", f"/accounts/{target.account_id}")["status"] == "active"


def test_revoking_a_device(admin, make_device):
    member = make_device("revokee")
    admin.ok("POST", f"/accounts/{member.account_id}/devices/{member.device_id}/revoke", {"reason": "lost phone"})
    assert status(member) in (401, 403)
    assert admin.ok("GET", f"/accounts/{member.account_id}")["activeDevices"] == 0


def test_integration_mark_round_trip(admin, make_device):
    bot = make_device("helpbot")
    assert admin.ok("GET", f"/accounts/{bot.account_id}/integration").get("integration") is None
    admin.ok("PUT", f"/accounts/{bot.account_id}/integration", {"kind": "bot", "retention": "Deleted after 30 days.", "reason": "help bot"})
    mark = admin.ok("GET", f"/accounts/{bot.account_id}/integration")["integration"]
    assert mark["kind"] == "bot" and mark["retention"] == "Deleted after 30 days."
    admin.ok("PUT", f"/accounts/{bot.account_id}/integration", {"kind": None, "retention": None, "reason": "retired"})
    assert admin.ok("GET", f"/accounts/{bot.account_id}/integration").get("integration") is None


def test_integration_needs_retention_text(admin, make_device):
    bot = make_device("archiver")
    r = admin.call("PUT", f"/accounts/{bot.account_id}/integration", {"kind": "archive", "retention": "", "reason": "x"})
    assert r.status_code == 400


def test_recovery_revoke_without_a_code(admin, target):
    assert admin.ok("POST", f"/accounts/{target.account_id}/recovery/revoke", {"reason": "no code"})["revoked"] is False


# --- sign-in accounts (identity provider) ------------------------------------------------------------

def test_sign_in_account_of_a_convo_account(admin, target):
    s = admin.ok("GET", f"/accounts/{target.account_id}/sign-in")
    assert s["user"]["username"] == target.user.username and s["convoAccountId"] == target.account_id


def test_idp_user_search_and_detail(admin, target):
    users = admin.ok("GET", "/idp/users", params={"q": target.user.username, "limit": 100})
    assert len(users) == 1 and users[0]["convoAccountId"] == target.account_id
    detail = admin.ok("GET", f"/idp/users/{users[0]['user']['id']}")
    assert detail["user"]["enabled"] is True


def test_create_user_shows_a_temporary_password_once(admin):
    name = f"newbie-{int(time.time() * 1000) % 10**8}"
    created = admin.ok("POST", "/idp/users", {"username": name, "firstName": "New", "lastName": "Bie", "email": f"{name}@example.test", "phone": "", "requirePasskey": False, "reason": "onboarding"})
    assert created["account"]["user"]["username"] == name and len(created["temporaryPassword"]) >= 12
    assert "UPDATE_PASSWORD" in created["account"]["user"]["requiredActions"]
    again = admin.call("POST", "/idp/users", {"username": name, "firstName": "", "lastName": "", "email": "", "phone": "", "requirePasskey": False, "reason": "dup"})
    assert again.status_code == 409


def test_create_user_rejects_bad_usernames(admin):
    r = admin.call("POST", "/idp/users", {"username": "bad name!", "firstName": "", "lastName": "", "email": "", "phone": "", "requirePasskey": False, "reason": "x"})
    assert r.status_code == 400


def test_password_reset_actions_sign_out_and_sign_in_switch(admin, make_device):
    member = make_device("idpops")
    uid = admin.ok("GET", f"/accounts/{member.account_id}/sign-in")["user"]["id"]
    assert len(admin.ok("POST", f"/idp/users/{uid}/reset-password", {"reason": "forgot"})["temporaryPassword"]) >= 12
    admin.ok("POST", f"/idp/users/{uid}/required-actions", {"actions": ["CONFIGURE_TOTP"], "reason": "mfa"})
    assert "CONFIGURE_TOTP" in admin.ok("GET", f"/idp/users/{uid}")["user"]["requiredActions"]
    admin.ok("POST", f"/idp/users/{uid}/sign-out", {"reason": "suspicious"})
    admin.ok("POST", f"/idp/users/{uid}/enabled", {"enabled": False, "reason": "leaver"})
    assert admin.ok("GET", f"/idp/users/{uid}")["user"]["enabled"] is False
    admin.ok("POST", f"/idp/users/{uid}/enabled", {"enabled": True, "reason": "returned"})


def test_unknown_required_actions_are_rejected(admin, target):
    uid = admin.ok("GET", f"/accounts/{target.account_id}/sign-in")["user"]["id"]
    assert admin.call("POST", f"/idp/users/{uid}/required-actions", {"actions": ["DROP_TABLES"], "reason": "x"}).status_code == 400


def test_granting_and_removing_a_role(admin, make_device):
    member = make_device("helper")
    uid = admin.ok("GET", f"/accounts/{member.account_id}/sign-in")["user"]["id"]
    admin.ok("POST", f"/idp/users/{uid}/roles", {"role": "convo-helpdesk", "granted": True, "reason": "on call"})
    holders = {h["id"] for r in admin.ok("GET", "/roles") if r["role"] == "convo-helpdesk" for h in r["holders"]}
    assert uid in holders
    admin.ok("POST", f"/idp/users/{uid}/roles", {"role": "convo-helpdesk", "granted": False, "reason": "off call"})


def test_unmanaged_roles_cannot_be_granted(admin, target):
    uid = admin.ok("GET", f"/accounts/{target.account_id}/sign-in")["user"]["id"]
    assert admin.call("POST", f"/idp/users/{uid}/roles", {"role": "realm-admin", "granted": True, "reason": "x"}).status_code in (400, 403)


def test_roles_view_lists_every_managed_role(admin):
    roles = {r["role"] for r in admin.ok("GET", "/roles")}
    assert {"convo-admin", "convo-helpdesk", "convo-org-admin", "convo-security", "convo-auditor"} <= roles


def test_guest_accounts_expire_and_can_be_extended(admin):
    name = f"guest-{int(time.time() * 1000) % 10**8}"
    created = admin.ok("POST", "/guests", {"username": name, "firstName": "G", "lastName": "Uest", "email": f"{name}@example.test", "days": 7, "reason": "contractor"})
    uid = created["account"]["user"]["id"]
    guest = admin.ok("GET", f"/guests/{uid}")
    assert guest.get("expiredAt") is None
    extended = admin.ok("POST", f"/guests/{uid}/extend", {"days": 14, "reason": "longer project"})
    assert extended["expiresAt"] > guest["expiresAt"]


# --- statistics -----------------------------------------------------------------------------------

@pytest.mark.parametrize("days", [1, 7, 30, 90])
def test_overview_fills_every_day(admin, days):
    o = admin.ok("GET", "/stats/overview", params={"days": days})
    assert len(o["days"]) == days and o["directory"]["accounts"] >= 1


def test_overview_with_a_date_range(admin):
    o = admin.ok("GET", "/stats/overview", params={"days": 30, "from": "2026-10-01", "to": "2026-10-07"})
    assert len(o["days"]) == 7


@pytest.mark.parametrize("order", ["active", "inactive"])
def test_users_by_activity(admin, order):
    users = admin.ok("GET", "/stats/users", params={"order": order, "days": 30, "limit": 5})
    assert len(users) <= 5 and all(u["level"] in ("high", "medium", "low", "none") for u in users)


def test_activity_levels_and_account_activity(admin, target):
    levels = admin.ok("GET", "/stats/levels", params={"days": 30})
    assert levels["window"] == 30 and sum(levels[k] for k in ("high", "medium", "low", "none")) >= 1
    a = admin.ok("GET", f"/accounts/{target.account_id}/activity", params={"days": 7})
    # Only days with activity are listed; the console fills the gaps.
    assert a["summary"]["account"]["accountId"] == target.account_id and a["window"] == 7 and len(a["days"]) <= 7


@pytest.mark.parametrize("minutes", [15, 60, 1440])
def test_throughput(admin, minutes):
    t = admin.ok("GET", "/stats/throughput", params={"minutes": minutes})
    assert "minutes" in t and "enabled" in t


# --- tables (server-side search, sort, paging) ----------------------------------------------------

@pytest.mark.parametrize("name,scope", [("people", {}), ("audit", {}), ("permissions", {}), ("health", {}), ("activity", {}),
                                        ("role-holders", {"role": "convo-admin"})])
def test_every_table_pages(admin, name, scope):
    page = table(admin, name, **scope)
    assert page["page"] == 1 and len(page["rows"]) <= 25


def test_people_table_finds_a_person(admin, target):
    page = table(admin, "people", q=target.user.username)
    assert page["total"] >= 1 and any(r["username"] == target.user.username for r in page["rows"])


@pytest.mark.parametrize("status", ["all", "joined", "pending", "blocked"])
def test_people_status_filters(admin, status):
    table(admin, "people", status=status)


def test_people_sorting_both_ways(admin):
    up = [r["username"] for r in table(admin, "people", sort="username", order="asc", size="50")["rows"]]
    down = [r["username"] for r in table(admin, "people", sort="username", order="desc", size="50")["rows"]]
    assert up == sorted(up, key=str.lower) or up == sorted(up)
    assert down == sorted(down, key=str.lower, reverse=True) or down == sorted(down, reverse=True)


def test_page_size_is_capped(admin):
    assert len(table(admin, "people", size="100000")["rows"]) <= 200


# --- audit chain ----------------------------------------------------------------------------------

def test_audit_search_verify_checkpoint_and_export(admin):
    entries = admin.ok("GET", "/audit", params={"limit": 100})
    assert entries and all({"seq", "hash", "action"} <= set(e) for e in entries)
    assert admin.ok("GET", "/audit/verify")["valid"] is True
    assert admin.ok("POST", "/audit/checkpoint")["valid"] is True
    admin.ok("POST", "/audit/export", {"reason": "quarterly review"})
    assert audited(admin, "audit.export", "quarterly review")


def test_audit_paging_with_before(admin):
    first = admin.ok("GET", "/audit", params={"limit": 100})
    older = admin.ok("GET", "/audit", params={"limit": 100, "before": first[-1]["seq"]})
    assert all(e["seq"] < first[-1]["seq"] for e in older)


def test_audit_sources(admin):
    assert "configured" in admin.ok("GET", "/audit/sources")


# --- health -----------------------------------------------------------------------------------------

def test_health_views(admin):
    assert "push" in admin.ok("GET", "/health")
    system = admin.ok("GET", "/health/system")
    assert system["status"] in ("UP", "DEGRADED", "DOWN") and system["components"]
    service = admin.ok("GET", "/health/service")
    assert {"messaging", "push", "groups", "devices24h"} <= set(service)


def test_push_redrive(admin):
    assert admin.ok("POST", "/push/redrive", {"reason": "after outage"})["queued"] >= 0


# --- policy ------------------------------------------------------------------------------------------

def test_policy_publish_is_versioned_and_signed(admin):
    current = admin.ok("GET", "/policy")
    published = admin.ok("PUT", "/policy", {"expectedVersion": current["version"], "policy": current["policy"], "reason": "re-sign"})
    assert published["version"] == current["version"] + 1 and published["keyId"]
    after = admin.ok("GET", "/policy")
    assert after["version"] == published["version"] and after["signed"]["publishedBy"]
    stale = admin.call("PUT", "/policy", {"expectedVersion": current["version"], "policy": current["policy"], "reason": "stale"})
    assert stale.status_code == 409


# --- security alerts ---------------------------------------------------------------------------------

def test_alert_summary_rules_and_resolve_all(admin):
    summary = admin.ok("GET", "/alerts/summary")
    assert {"open", "acknowledged", "critical"} <= set(summary)
    rules = admin.ok("GET", "/alerts/rules")
    assert len(rules) >= 10
    rule = rules[0]
    updated = admin.ok("POST", f"/alerts/rules/{rule['id']}", {**rule, "reason": "tune"})
    assert any(r["id"] == rule["id"] for r in updated)
    assert admin.ok("POST", "/alerts/resolve-all", {"reason": ""}, params={"q": "no-such-alert-xyz"})["resolved"] == 0


def test_scoped_tables_need_their_scope(admin):
    assert admin.call("GET", "/tables/role-holders", params={"role": "realm-admin"}).status_code == 400
    assert admin.call("GET", "/tables/sessions").status_code == 400


def test_sessions_of_a_sign_in_account(admin, target):
    uid = admin.ok("GET", f"/accounts/{target.account_id}/sign-in")["user"]["id"]
    page = table(admin, "sessions", user=uid)
    assert page["total"] >= 0
