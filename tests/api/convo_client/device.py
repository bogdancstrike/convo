"""A Convo device: enrollment, signed requests (ENCLAVE-REQ-V2), WebSocket mailbox and sends."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import secrets
import ssl
import threading
import time
import uuid
from dataclasses import dataclass, field

import requests
import websocket
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, x25519
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

BASE_URL = os.environ.get("BASE_URL", "https://localhost:8443")
SIGNING_PROFILE = "p256-ecdsa-sha256-v1"


def b64u(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def unb64u(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


class ApiError(Exception):
    def __init__(self, status: int, code: str | None, detail: str, body: dict | None = None):
        super().__init__(f"{status} {code}: {detail}")
        self.status, self.code, self.detail, self.body = status, code, detail, body or {}


def _djb_public() -> bytes:
    """A serialized Curve25519 public key (0x05 prefix), as Signal encodes identity and prekeys."""
    raw = x25519.X25519PrivateKey.generate().public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
    return b"\x05" + raw


@dataclass
class Device:
    """One enrolled device. Create with `Device.enroll(token)`."""
    base_url: str = BASE_URL
    signing_key: ec.EllipticCurvePrivateKey = field(default_factory=lambda: ec.generate_private_key(ec.SECP256R1()))
    identity_key: bytes = field(default_factory=_djb_public)
    registration_id: int = field(default_factory=lambda: secrets.randbelow(16383) + 1)
    account_id: str = ""
    device_id: int = 0
    http: requests.Session = field(default_factory=requests.Session)
    nonces: list = field(default_factory=list)

    def __post_init__(self):
        self.http.verify = False
        self.base_url = self.base_url.rstrip("/")
        self._lock = threading.Lock()

    @property
    def address(self) -> str:
        return f"{self.account_id}.{self.device_id}"

    def spki(self) -> bytes:
        return self.signing_key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)

    def sign(self, data: bytes) -> bytes:
        """ECDSA P-256 / SHA-256 in IEEE P1363 form (r || s), like WebCrypto."""
        r, s = decode_dss_signature(self.signing_key.sign(data, ec.ECDSA(hashes.SHA256())))
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")

    # --- enrollment ---------------------------------------------------------------------------------

    @classmethod
    def enroll(cls, token: str, base_url: str = BASE_URL, platform: str = "web", prekeys: int = 20) -> "Device":
        device = cls(base_url=base_url)
        reservation = device.bearer("POST", "/v1/devices/reservations", token, {"purpose": "primary"})
        device.account_id, device.device_id = reservation["accountId"], reservation["deviceId"]
        transcript = "\n".join(["ENCLAVE-ENROLL-V1", reservation["deploymentId"], device.address, reservation["reservationId"],
                                reservation["challenge"], b64u(device.identity_key), str(device.registration_id),
                                b64u(hashlib.sha256(device.spki()).digest())]).encode()
        device.bearer("POST", "/v1/devices/primary", token, device.registration_body(reservation["reservationId"], transcript, platform, prekeys))
        return device

    @classmethod
    def link(cls, token: str, existing: "Device", base_url: str = BASE_URL, platform: str = "android", prekeys: int = 20,
             deliver: bool = True) -> "Device":
        """Links a second device to `existing`'s account: provisioning session, code from the
        existing device, registration with the account identity key (the E2EE transfer is simulated)."""
        device = cls(base_url=base_url, identity_key=existing.identity_key)
        session = device.bearer("POST", "/v1/provisioning/sessions", token, {"ephemeralPublicKey": b64u(_djb_public()[1:]), "clientLabel": "API test"})
        device.account_id, device.device_id = session["accountId"], session["deviceId"]
        code = existing.signed("POST", "/v1/devices/provisioning-code", {"provisioningId": session["provisioningId"]})["code"]
        if deliver:
            existing.signed("POST", f"/v1/provisioning/sessions/{session['provisioningId']}/message",
                            {"ephemeralPublicKey": b64u(_djb_public()[1:]), "message": b64u(os.urandom(96))})
        transcript = "\n".join(["ENCLAVE-ENROLL-V1", session["deploymentId"], device.address, session["reservationId"],
                                session["challenge"], b64u(device.identity_key), str(device.registration_id),
                                b64u(hashlib.sha256(device.spki()).digest())]).encode()
        body = device.registration_body(session["reservationId"], transcript, platform, prekeys)
        body.pop("reservationId")
        device.bearer("POST", "/v1/devices/link", token, {**body, "provisioningId": session["provisioningId"], "provisioningCode": code})
        return device

    def drain(self, limit: int = 100) -> dict:
        """HTTP mailbox page (envelopes stay queued until acknowledged)."""
        return self.signed("GET", f"/v1/messages?limit={limit}")

    def ack(self, guid: str) -> None:
        self.signed("DELETE", f"/v1/messages/{guid}")

    def registration_body(self, reservation_id: str, transcript: bytes, platform: str, prekeys: int) -> dict:
        return {
            "reservationId": reservation_id, "identityKey": b64u(self.identity_key), "registrationId": self.registration_id,
            "signedPreKey": {"keyId": 1, "publicKey": b64u(_djb_public()), "signature": b64u(os.urandom(64))},
            "preKeys": [{"keyId": i + 1, "publicKey": b64u(_djb_public())} for i in range(prekeys)],
            "signingKey": b64u(self.spki()), "signingKeyProfile": SIGNING_PROFILE,
            "registrationProof": b64u(self.sign(transcript)), "platform": platform,
        }

    # --- HTTP -----------------------------------------------------------------------------------------

    def bearer(self, method: str, path: str, token: str, body=None):
        return self._send(method, path, body, {"Authorization": f"Bearer {token}"})

    def _take_nonce(self) -> str:
        with self._lock:
            now = time.time()
            self.nonces = [n for n in self.nonces if now - n[1] < 90]
            if not self.nonces:
                r = self.http.post(f"{self.base_url}/v1/device-nonces", json={"device": self.address}, timeout=30)
                self.nonces = [(n, time.time()) for n in r.json().get("nonces", [])] if r.ok else []
            # No nonce (revoked/unknown device): a placeholder gets the server's authoritative answer.
            return self.nonces.pop()[0] if self.nonces else b64u(os.urandom(24))

    def signed_headers(self, method: str, path: str, body: bytes, nonce: str | None = None, request_id: str | None = None,
                       expires: int | None = None) -> dict:
        nonce = self._take_nonce() if nonce is None else nonce
        request_id = b64u(os.urandom(18)) if request_id is None else request_id
        expires = int(time.time() * 1000) + 60_000 if expires is None else expires
        canonical = "\n".join(["ENCLAVE-REQ-V2", method, path, b64u(hashlib.sha256(body).digest()), self.address, request_id, nonce, str(expires)])
        return {"Authorization": f"EnclaveDevice {self.address}", "X-Enclave-Request-Id": request_id, "X-Enclave-Nonce": nonce,
                "X-Enclave-Expires": str(expires), "X-Enclave-Signature": b64u(self.sign(canonical.encode()))}

    def signed(self, method: str, path: str, body=None, retry: bool = True):
        raw = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
        try:
            return self._send(method, path, raw, self.signed_headers(method, path, raw), raw=True)
        except ApiError as e:
            if retry and e.code == "NONCE_INVALID":
                with self._lock:
                    self.nonces = []
                return self.signed(method, path, body, retry=False)
            raise

    def raw_request(self, method: str, path: str, headers: dict, body: bytes = b"") -> requests.Response:
        """Unprocessed request (security tests craft their own headers)."""
        h = {"Accept": "application/json", **({"Content-Type": "application/json"} if body else {}), **headers}
        return self.http.request(method, f"{self.base_url}{path}", headers=h, data=body or None, timeout=30)

    def _send(self, method: str, path: str, body, headers: dict, raw: bool = False):
        data = body if raw else (None if body is None else json.dumps(body, separators=(",", ":")).encode())
        h = {"Accept": "application/json", **headers}
        if data:
            h["Content-Type"] = "application/json"
        r = self.http.request(method, f"{self.base_url}{path}", headers=h, data=data or None, timeout=30)
        nxt = r.headers.get("X-Enclave-Next-Nonce")
        if nxt and len(nxt) == 32:
            with self._lock:
                self.nonces.append((nxt, time.time()))
        if not r.ok:
            try:
                problem = r.json()
            except ValueError:
                problem = {}
            raise ApiError(r.status_code, problem.get("code"), problem.get("detail", r.text[:200]), problem)
        if r.status_code == 204 or not r.content:
            return None
        return r.json()

    # --- messaging --------------------------------------------------------------------------------------

    def roster(self, account_id: str) -> dict:
        return self.signed("GET", f"/v1/accounts/{account_id}/devices")

    def send_to(self, account_id: str, size: int = 160, urgent: bool = False) -> dict:
        """Sends one opaque 'ciphertext' to every device of `account_id` (except this one)."""
        roster = self.roster(account_id)
        messages = [{"deviceId": d["deviceId"], "registrationId": d["registrationId"], "type": "CIPHERTEXT", "content": b64u(os.urandom(size))}
                    for d in roster["devices"] if not (account_id == self.account_id and d["deviceId"] == self.device_id)]
        return self.signed("PUT", f"/v1/messages/{account_id}", {"destination": account_id, "submissionId": b64u(os.urandom(16)),
                                                               "messages": messages, "urgent": urgent, "transientTtlSeconds": 0})

    def socket(self) -> "Mailbox":
        return Mailbox(self)


class Mailbox:
    """The device's WebSocket: receives envelopes and acknowledges them."""

    def __init__(self, device: Device, timeout: float = 30):
        self.device = device
        ticket = device.signed("POST", "/v1/ws/tickets")["ticket"]
        url = device.base_url.replace("https://", "wss://").replace("http://", "ws://") + "/v1/ws"
        self.ws = websocket.create_connection(url, subprotocols=["enclave.v1", f"ticket.{ticket}"], origin=device.base_url,
                                              sslopt={"cert_reqs": ssl.CERT_NONE}, timeout=timeout)
        self._request = 1

    def receive(self, count: int, timeout: float = 30, ack: bool = True) -> list[dict]:
        """Collects `count` envelopes (acknowledging them) or raises TimeoutError."""
        envelopes, deadline = [], time.time() + timeout
        while len(envelopes) < count:
            self.ws.settimeout(max(0.1, deadline - time.time()))
            try:
                frame = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException as e:
                raise TimeoutError(f"received {len(envelopes)}/{count} envelopes") from e
            if "envelope" in frame and frame["envelope"]:
                envelopes.append(frame["envelope"])
                if ack:
                    self.ws.send(json.dumps({"requestId": 0, "ack": {"guids": [frame["envelope"]["guid"]]}}))
            if time.time() > deadline:
                raise TimeoutError(f"received {len(envelopes)}/{count} envelopes")
        return envelopes

    def frames(self, seconds: float) -> list[dict]:
        """Every frame received within `seconds` (for directives and empty-queue markers)."""
        out, deadline = [], time.time() + seconds
        while time.time() < deadline:
            self.ws.settimeout(max(0.05, deadline - time.time()))
            try:
                out.append(json.loads(self.ws.recv()))
            except websocket.WebSocketTimeoutException:
                break
        return out

    def close(self):
        try:
            self.ws.close()
        except Exception:  # noqa: BLE001 - best effort
            pass


def new_id() -> str:
    return str(uuid.uuid4())
