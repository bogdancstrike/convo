"""Shared fixtures for the API suites: Keycloak bootstrap, enrolled devices, endpoint inventory."""
from __future__ import annotations

import json
import os
import re
import uuid

import pytest
import urllib3

from convo_client import Device, Keycloak

urllib3.disable_warnings()
HERE = os.path.dirname(__file__)
ENDPOINTS = json.load(open(os.path.join(HERE, "endpoints.json")))

# Mirrors SecurityConfig: unauthenticated routes and Keycloak-token (account) routes.
PUBLIC = {("GET", "/v1/deployment-info"), ("POST", "/v1/device-nonces"), ("GET", "/v1/kt/head"), ("GET", "/v1/kt/consistency"),
          ("POST", "/v1/kt/cosignatures"), ("GET", "/v1/kt/leaves")}
ACCOUNT = {("GET", "/v1/recovery"), ("POST", "/v1/recovery/reservations"), ("POST", "/v1/devices/recover"), ("POST", "/v1/devices/reservations"),
           ("POST", "/v1/devices/primary"), ("POST", "/v1/devices/link"), ("POST", "/v1/provisioning/sessions"),
           ("GET", "/v1/provisioning/sessions/{provisioningId}"), ("DELETE", "/v1/provisioning/sessions/{provisioningId}")}


def kind(endpoint: dict) -> str:
    key = (endpoint["method"], endpoint["path"])
    if key in PUBLIC:
        return "public"
    if key in ACCOUNT:
        return "account"
    return endpoint["chain"]


def device_endpoints():
    return [e for e in ENDPOINTS if kind(e) == "device"]


def admin_endpoints():
    return [e for e in ENDPOINTS if kind(e) == "admin"]


def endpoint_id(e: dict) -> str:
    return f"{e['method']} {e['path']}"


def fill(path: str, values: dict | None = None) -> str:
    """Concrete path for a template: real values where given, plausible placeholders otherwise."""
    values = values or {}
    defaults = {"accountId": str(uuid.uuid4()), "deviceId": "1", "groupId": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "communityId": str(uuid.uuid4()), "attachmentId": str(uuid.uuid4()), "callId": str(uuid.uuid4()), "id": str(uuid.uuid4()),
                "guid": str(uuid.uuid4()), "token": "A" * 43, "submissionId": "AAAAAAAAAAAAAAAAAAAAAA", "provisioningId": str(uuid.uuid4())}
    return re.sub(r"\{(\w+)\}", lambda m: str(values.get(m.group(1), defaults.get(m.group(1), "x"))), path)


@pytest.fixture(scope="session")
def kc() -> Keycloak:
    k = Keycloak()
    k.ensure_test_client()
    return k


@pytest.fixture(scope="session")
def make_device(kc):
    """Factory: a fresh user with one enrolled device."""
    def make(prefix: str = "api", **kwargs) -> Device:
        user = kc.create_user(prefix, **kwargs)
        device = Device.enroll(kc.user_token(user))
        device.user = user  # type: ignore[attr-defined]
        return device
    return make


@pytest.fixture(scope="session")
def alice(make_device) -> Device:
    return make_device("alice")


@pytest.fixture(scope="session")
def bob(make_device) -> Device:
    return make_device("bob")
