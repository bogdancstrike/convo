from svglib import *

W, H = 1000, 600
b = []
# zones first
b.append(zone(32, 72, 248, 288, 'YOUR DEVICES · KEYS STAY HERE', security=True))
b.append(zone(328, 72, 304, 408, 'CONVO ORIGIN · convo.doncik.ro'))
b.append(zone(680, 72, 288, 408, 'SELF-HOSTED · CIPHERTEXT ONLY'))

# arrows (before nodes)
b.append(path('M 248,120 H 364'))                                                     # web -> proxy
b.append(label(306, 108, 'HTTPS · WSS'))
b.append(path('M 248,260 H 296 Q 304,260 304,252 V 148 Q 304,140 312,140 H 364'))    # android -> proxy
b.append(path('M 480,168 V 228'))                                                     # proxy -> server
b.append(label(548, 204, '/v1 · DEVICE-SIGNED'))
b.append(path('M 364,160 H 352 Q 344,160 344,168 V 380 Q 344,388 352,388 H 364'))    # proxy -> keycloak
b.append(label(376, 344, '/auth'))
b.append(path('M 596,132 H 704'))                                                     # proxy -> livekit
b.append(label(650, 120, '/rtc'))
b.append(path('M 596,256 H 704', 'accent'))                                          # server -> stores
b.append(label(650, 244, 'CIPHERTEXT', ACCENT))
b.append(path('M 596,280 H 640 Q 648,280 648,288 V 380 Q 648,388 656,388 H 704'))    # server -> ntfy
b.append(label(616, 336, 'WAKE'))
b.append(path('M 816,424 V 504 Q 816,512 808,512 H 168 Q 160,512 160,504 V 300', 'link', dashed=True))  # ntfy -> android
b.append(label(488, 500, 'CONTENT-FREE WAKE', LINK))
b.append(path('M 236,96 V 44 Q 236,36 244,36 H 916 Q 924,36 924,44 V 92', 'link', dashed=True))   # web -> livekit media
b.append(label(580, 24, 'CALL MEDIA · E2EE FRAMES', LINK))

# nodes
b.append(node(56, 96, 192, 72, 'Web app', 'React · Signal · MLS', 'user', 'CLIENT'))
b.append(node(56, 224, 192, 72, 'Android app', 'Compose · same core', 'user', 'CLIENT'))
b.append(node(364, 96, 232, 72, 'Same-origin proxy', 'nginx · CSP · TLS', 'step', 'EDGE'))
b.append(node(364, 228, 232, 72, 'Convo server', 'ciphertext relay · no keys', 'focal', 'API'))
b.append(node(364, 352, 232, 72, 'Keycloak', 'OIDC · PKCE · passkeys', 'step', 'IDP'))
b.append(node(704, 96, 240, 72, 'LiveKit SFU + coturn', 'WebRTC · frames stay encrypted', 'external', 'MEDIA'))
b.append(node(704, 224, 240, 72, 'PostgreSQL · MinIO · Valkey', 'mailboxes · attachments · hints', 'store', 'STORE'))
b.append(node(704, 352, 240, 72, 'ntfy (UnifiedPush)', 'constant wake payload', 'external', 'PUSH'))

b.append(legend(560, W, [(zone_sample(True), 'Plaintext + keys (E2EE boundary)'), (line_sample(), 'HTTPS via the proxy'),
                          (line_sample('link', True), 'Media / push, no content'), (box_sample('focal'), 'Sees ciphertext only')]))
open('../architecture.html', 'w').write(page('architecture', 'Architecture · Convo security', 'Convo architecture and trust boundaries',
    'Convo web and Android clients hold all keys and plaintext; the proxy, server, identity provider, stores, push and call media services only handle ciphertext and metadata.',
    W, H, '\n'.join(b),
    'Messages are encrypted on the devices (Signal for 1:1, MLS for groups). Everything to the right of the dashed boundary relays or stores ciphertext and metadata. Call media and push wake-ups bypass the proxy and still carry no readable content.'))
