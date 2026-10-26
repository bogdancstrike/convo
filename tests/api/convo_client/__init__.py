"""Python client for Convo's device API, used by the API test suites and the Locust load test.

It enrolls real devices (P-256 request-signing key, Curve25519 identity key) and signs every request
exactly like the apps (profile ENCLAVE-REQ-V2 with single-use server nonces). Message payloads are
opaque random bytes: the server only ever sees ciphertext, so its behaviour is the same.
"""
from .keycloak import Keycloak, TestUser
from .device import Device, ApiError

__all__ = ["Keycloak", "TestUser", "Device", "ApiError"]
