"""Development Keycloak helpers: realm users and a password-grant test client (dev stack only)."""
from __future__ import annotations

import os
import secrets
import string
from dataclasses import dataclass

import requests

BASE_URL = os.environ.get("BASE_URL", "https://localhost:8443")
ADMIN_USER = os.environ.get("KEYCLOAK_ADMIN", "admin")
ADMIN_PASSWORD = os.environ.get("KEYCLOAK_ADMIN_PASSWORD", "admin-dev-password")
REALM = "enclave"
# Test-only public client with the password grant. Created on demand in the development stack;
# never part of the realm import or production setup.
TEST_CLIENT = "convo-api-tests"


def _random(n: int = 6) -> str:
    return "".join(secrets.choice(string.ascii_lowercase + string.digits) for _ in range(n))


@dataclass
class TestUser:
    username: str
    password: str
    name: str
    phone: str
    id: str = ""


class Keycloak:
    def __init__(self, base_url: str = BASE_URL, session: requests.Session | None = None):
        self.base = base_url.rstrip("/")
        self.http = session or requests.Session()
        self.http.verify = False
        self._admin: str | None = None

    def admin_token(self) -> str:
        r = self.http.post(f"{self.base}/auth/realms/master/protocol/openid-connect/token",
                           data={"grant_type": "password", "client_id": "admin-cli", "username": ADMIN_USER, "password": ADMIN_PASSWORD})
        r.raise_for_status()
        self._admin = r.json()["access_token"]
        return self._admin

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._admin or self.admin_token()}"}

    def _admin_call(self, method: str, path: str, **kwargs) -> requests.Response:
        r = self.http.request(method, f"{self.base}/auth/admin/realms/{REALM}{path}", headers=self._headers(), **kwargs)
        if r.status_code == 401:  # admin token expired (60 s by default)
            self.admin_token()
            r = self.http.request(method, f"{self.base}/auth/admin/realms/{REALM}{path}", headers=self._headers(), **kwargs)
        return r

    def ensure_test_client(self) -> None:
        r = self._admin_call("GET", "/clients", params={"clientId": TEST_CLIENT})
        r.raise_for_status()
        if r.json():
            return
        created = self._admin_call("POST", "/clients", json={
            "clientId": TEST_CLIENT, "enabled": True, "publicClient": True, "standardFlowEnabled": False,
            "directAccessGrantsEnabled": True, "description": "Convo API tests (development stack only)",
            "defaultClientScopes": ["web-origins", "acr", "profile", "roles", "phone", "basic", "email"]})
        if created.status_code not in (201, 409):
            created.raise_for_status()

    def create_user(self, prefix: str = "api", realm_roles: list[str] | None = None, phone: bool = True) -> TestUser:
        suffix = _random()
        user = TestUser(username=f"{prefix}-{suffix}", password=f"pw-{_random(12)}", name=f"{prefix.capitalize()} {suffix.capitalize()}",
                        phone=f"+40 7{secrets.randbelow(10**8):08d}")
        r = self._admin_call("POST", "/users", json={
            "username": user.username, "enabled": True, "email": f"{user.username}@example.test", "emailVerified": True,
            "firstName": prefix.capitalize(), "lastName": suffix.capitalize(),
            "attributes": {"phoneNumber": [user.phone]} if phone else {}, "requiredActions": [],
            "credentials": [{"type": "password", "value": user.password, "temporary": False}]})
        assert r.status_code == 201, f"user creation failed: {r.status_code} {r.text}"
        user.id = r.headers["Location"].rsplit("/", 1)[-1]
        for role in realm_roles or []:
            rep = self._admin_call("GET", f"/roles/{role}").json()
            self._admin_call("POST", f"/users/{user.id}/role-mappings/realm", json=[rep]).raise_for_status()
        return user

    def user_token(self, user: TestUser) -> str:
        r = self.http.post(f"{self.base}/auth/realms/{REALM}/protocol/openid-connect/token",
                           data={"grant_type": "password", "client_id": TEST_CLIENT, "username": user.username, "password": user.password,
                                 "scope": "openid profile phone"})
        assert r.status_code == 200, f"token for {user.username}: {r.status_code} {r.text}"
        return r.json()["access_token"]

    def delete_user(self, user: TestUser) -> None:
        self._admin_call("DELETE", f"/users/{user.id}")
