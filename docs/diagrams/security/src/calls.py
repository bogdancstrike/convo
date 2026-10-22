from svglib import *

W, H = 1000, 560
b = []
b.append(zone(32, 72, 232, 368, 'CALLER · KEYS HERE', security=True))
b.append(zone(736, 72, 232, 368, 'CALLEE · KEYS HERE', security=True))
b.append(zone(312, 72, 376, 368, 'HOMELAB · SEES ENCRYPTED FRAMES'))
# arrows
b.append(path('M 240,132 H 352'))                                   # caller -> convo (ring)
b.append(label(296, 120, 'RING (E2EE MSG)'))
b.append(path('M 648,132 H 760'))                                   # convo -> callee
b.append(label(704, 120, 'DELIVER'))
b.append(path('M 500,168 V 228'))                                   # convo -> livekit token
b.append(label(560, 204, 'ROOM TOKEN'))
b.append(path('M 240,272 H 352', 'accent'))                         # caller -> livekit media
b.append(label(296, 260, 'SRTP · E2EE', ACCENT))
b.append(path('M 760,288 H 656', 'accent'))                         # callee -> livekit media (reverse arrow into sfu)
b.append(label(704, 276, 'SRTP · E2EE', ACCENT))
b.append(path('M 136,308 V 376 Q 136,384 144,384 H 352', 'muted', dashed=True))   # caller -> turn
b.append(label(232, 372, 'IF UDP BLOCKED'))
b.append(path('M 500,352 V 316', 'muted', dashed=True))             # turn -> sfu
b.append(label(548, 340, 'RELAY'))
# nodes
b.append(node(56, 96, 184, 72, 'Caller device', 'frame key per call', 'user', 'CLIENT'))
b.append(node(56, 236, 184, 72, 'WebRTC stack', 'encrypts every frame', 'user'))
b.append(node(760, 96, 184, 72, 'Callee device', 'gets key in the ring', 'user', 'CLIENT'))
b.append(node(760, 252, 184, 72, 'WebRTC stack', 'decrypts frames', 'user'))
b.append(node(352, 96, 296, 72, 'Convo server', 'signalling as encrypted messages', 'step', 'API'))
b.append(node(352, 228, 296, 88, 'LiveKit SFU', 'forwards frames · UDP 50000-50100 · TCP 7881', 'focal', 'MEDIA'))
b.append(node(352, 352, 296, 64, 'coturn (TURN)', 'UDP/TCP 3478 · relay 49160-49200', 'external', 'RELAY'))
b.append(legend(492, W, [(line_sample('accent'), 'Media, end-to-end encrypted'), (line_sample(), 'Signalling'),
                          (line_sample('muted', True), 'Fallback path'), (zone_sample(True), 'Holds the call key')]))
open('../calls.html', 'w').write(page('calls', 'Architecture · Convo security', 'How voice and video calls work',
    'The call key travels inside an end-to-end encrypted ring message; media flows through the LiveKit SFU (or via coturn when UDP is blocked) as frames the server cannot decrypt.',
    W, H, '\n'.join(b),
    'A ring is an ordinary end-to-end encrypted message that carries the per-call frame key. The Convo server only issues a LiveKit room token. LiveKit forwards media without being able to decrypt it; coturn relays packets for devices behind restrictive NATs. There is no unencrypted fallback.'))
