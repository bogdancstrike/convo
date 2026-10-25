# Convo calls on a public VPS (IP only)

## Why

Convo's web, API and call signalling reach the homelab through a Cloudflare tunnel, which only
carries HTTP/WebSocket. Call audio/video is UDP and must reach the media server's address directly;
with LiveKit in the homelab, phones are offered the home IP on ports nothing forwards, so calls
connect, stay silent and drop. This folder moves only LiveKit (media server) and coturn (relay) to a
public VPS. Signalling still goes through the tunnel, so the homelab IP stays private.

```
phone ─HTTPS/WSS─▶ convo.doncik.ro (tunnel) ─▶ convo-web /rtc ─HTTPS, pinned cert─▶ VPS:7443 ─▶ LiveKit
phone ◀──── UDP 50000-60000 · TCP 7881 · TURN 3478 (relay 49160-49200) ────▶ VPS 31.97.192.121
```

The VPS needs no domain: phones use its IP for media, and Convo talks to it over TLS with the
self-signed certificate in `certs/`, which Convo pins (trusts only that certificate). Media is
end-to-end encrypted (frame E2EE); the VPS forwards ciphertext and never has the keys.

## Files

| File | Purpose |
|---|---|
| `docker-compose-calls.yaml` | LiveKit, coturn and nginx (TLS on port 7443), all on the host network |
| `nginx.conf` | TLS in front of LiveKit's signalling/API |
| `.env` | Generated values: VPS IP, LiveKit secret, TURN password (**secret, not committed**) |
| `certs/rtc.crt`, `certs/rtc.key` | Self-signed certificate for `31.97.192.121` + name `convo-rtc` (**key is secret, not committed**) |
| `gen-certs.sh` | Recreates the certificate: `./gen-certs.sh <ip>` |

## 1. Open ports on the VPS

```sh
ufw allow 7443/tcp          # signalling + room API (from the homelab, via TLS)
ufw allow 7881/tcp          # media over TCP (networks that block UDP)
ufw allow 50000:60000/udp   # media
ufw allow 3478              # TURN, UDP and TCP
ufw allow 49160:49200/udp   # TURN relay range
```

Open the same ports in the hosting provider's firewall too, if it has one. Docker must be installed.

## 2. Copy and start

```sh
scp -r deploy/calls-vps root@31.97.192.121:/opt/convo-calls     # includes .env and certs/
ssh root@31.97.192.121 'cd /opt/convo-calls && docker compose -f docker-compose-calls.yaml up -d'
```

Check on the VPS:

```sh
docker compose -f docker-compose-calls.yaml ps                 # livekit, coturn, tls: running
curl -sk https://127.0.0.1:7443                                 # → OK
docker compose -f docker-compose-calls.yaml logs livekit | grep nodeIP   # → 31.97.192.121
```

## 3. Point Convo at it (homelab)

1. Use the VPS's LiveKit secret in the cluster (from `.env`):

   ```sh
   LIVEKIT_API_SECRET='<LIVEKIT_API_SECRET from .env>' app-charts/convo/utils/create-secrets.sh
   ```

2. Chart values (`app-charts/convo`), with the contents of `certs/rtc.crt` as the certificate:
   - `web/values.yaml` env: `UPSTREAM_LIVEKIT: "https://31.97.192.121:7443"`,
     `UPSTREAM_LIVEKIT_TLS_NAME: "convo-rtc"`, `UPSTREAM_LIVEKIT_CERT: |` (the PEM)
   - `server/values.yaml` env: `ENCLAVE_CALLS_LIVEKIT_URL: "https://31.97.192.121:7443"`,
     `ENCLAVE_CALLS_LIVEKIT_CERTIFICATE: |` (the PEM)

3. Restart the Convo server and web pods (Argo CD sync does it). The in-cluster `charts/livekit`
   and `charts/coturn` can then be removed.

Clients need no change. Check a call between two phones on different networks (e.g. one on Wi-Fi,
one on mobile data).

## Rotating

- New certificate: `./gen-certs.sh 31.97.192.121`, restart `tls`, then update both PEM values.
- New LiveKit secret: change `.env`, restart `livekit`, then re-run step 3.1.
