# Convo calls on a public VPS (LiveKit + coturn)

## Why

Convo's web, API and signalling traffic reaches the homelab through a Cloudflare tunnel, which only
carries HTTP/WebSocket over TCP. WebRTC media is UDP and must reach the SFU's address directly. With
LiveKit inside the homelab, phones are offered the home public address on UDP 50000–50100/TCP 7881;
nothing forwards those ports (and the home IP should stay private), and `turn.doncik.ro` has no DNS
record. ICE never connects, so both sides see the call, answer, hear nothing, and LiveKit drops them
after the connection timeout.

Moving only LiveKit and coturn to a VPS fixes this without exposing the homelab:

```
phone ─HTTPS/WSS─▶ Cloudflare tunnel ─▶ convo-web /rtc ─HTTPS─▶ Caddy :443 ─▶ LiveKit :7880   (signalling, small)
phone ◀── UDP 50000-60000 · TCP 7881 · TURN 3478 (UDP/TCP, relay 49160-49200) ──▶ VPS          (media, E2EE frames)
```

Media stays end-to-end encrypted (frame E2EE): the VPS forwards ciphertext and never has the keys.

## 1. DNS (Cloudflare, **DNS only / grey cloud**)

| Name | Type | Value |
|---|---|---|
| `rtc.doncik.ro` | A | `31.97.192.121` |
| `turn.doncik.ro` | A | `31.97.192.121` |

Grey cloud matters for `turn` (UDP cannot pass Cloudflare's proxy) and lets Caddy obtain a
certificate for `rtc` directly.

## 2. Firewall on the VPS

```sh
ufw allow 80/tcp           # Let's Encrypt HTTP challenge
ufw allow 443/tcp          # signalling + room API (Caddy)
ufw allow 7881/tcp         # ICE over TCP (networks that block UDP)
ufw allow 50000:60000/udp  # media
ufw allow 3478             # TURN, UDP and TCP
ufw allow 49160:49200/udp  # TURN relay range
```

Also open the same ports in the hosting provider's firewall if it has one.

## 3. Start

```sh
scp -r deploy/calls-vps root@31.97.192.121:/opt/convo-calls
ssh root@31.97.192.121
cd /opt/convo-calls && cp .env.example .env && vi .env   # see below
docker compose -f docker-compose-calls.yaml up -d
```

`.env`: `LIVEKIT_API_SECRET` must equal the server's (`kubectl -n apps get secret convo-livekit
-o jsonpath='{.data.api-secret}' | base64 -d`); `TURN_PASSWORD` is any long random string
(`openssl rand -hex 24`).

## 4. Check

```sh
curl https://rtc.doncik.ro                     # → OK (LiveKit behind Caddy, valid certificate)
docker compose -f docker-compose-calls.yaml logs livekit | grep nodeIP   # → 31.97.192.121
# From another machine: TURN allocation with the configured user
docker run --rm --network host coturn/coturn:4.6.3 turnutils_uclient -u convo -w "$TURN_PASSWORD" -y turn.doncik.ro
```

## 5. Point Convo at it (homelab charts, `app-charts/convo`)

- `web/values.yaml`: `UPSTREAM_LIVEKIT: "https://rtc.doncik.ro"` (convo-web proxies `/rtc` to it with
  TLS verification; needs web ≥ 1.11.0).
- `server/values.yaml`: `ENCLAVE_CALLS_LIVEKIT_URL: "https://rtc.doncik.ro"` (room API: removing
  members who left, key rotation).
- The in-cluster `charts/livekit` and `charts/coturn` apps can then be removed.

Clients need no change: they keep using `https://convo.doncik.ro/rtc` for signalling and receive
the VPS address and TURN servers from LiveKit.
