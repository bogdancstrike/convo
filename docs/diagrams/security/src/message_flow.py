from svglib import *

W, H = 1000, 640
X = {'a': 120, 's': 380, 'b1': 640, 'b2': 880}
TOP, BOTTOM = 112, 540
b = []
# actors
actors = [('a', 'Ana · web', 'holds identity + sessions', 'user'), ('s', 'Convo server', 'mailboxes, no keys', 'focal'),
          ('b1', 'Bogdan · phone', 'Android', 'user'), ('b2', 'Bogdan · laptop', 'linked web device', 'user')]
for k, name, sub, kind in actors:
    b.append(f'<line x1="{X[k]}" y1="{TOP}" x2="{X[k]}" y2="{BOTTOM}" stroke="rgba(23,50,77,0.20)" stroke-width="1" stroke-dasharray="3,3"/>')
for k, name, sub, kind in actors:
    b.append(node(X[k] - 92, 48, 184, 56, name, sub, kind))

def msg(y, x1, x2, text, kind='muted', dashed=False, open_=False):
    d = f'M {x1},{y} H {x2 - (8 if x2 > x1 else -8)}'
    out = path(d, kind, dashed)
    if open_: out = out.replace('url(#arrow)', 'url(#arrow-open)')
    lx = (x1 + x2) / 2
    return out + label(lx, y - 8, text, ACCENT if kind == 'accent' else SOFT)

def self_note(y, x, text):
    return (f'<path d="M {x+4},{y} H {x+40} V {y+16} H {x+12}" fill="none" stroke="{MUTED}" stroke-width="1.2" marker-end="url(#arrow)"/>'
            f'<text x="{x+48}" y="{y+12}" fill="{MUTED}" font-size="9" font-family="{MONO}">{text}</text>')

y = 152
b.append(msg(y, X['a'], X['s'], 'fetch prekey bundles · every device'))
y += 36
b.append(msg(y, X['s'], X['a'], 'identity + signed prekey + one-time prekey', dashed=True))
y += 28
b.append(self_note(y, X['a'], 'X3DH + Double Ratchet'))
y += 52
b.append(msg(y, X['a'], X['s'], 'one ciphertext per device', 'accent'))
y += 28
b.append(self_note(y, X['s'], 'queue one envelope per device'))
y += 52
b.append(msg(y, X['s'], X['b1'], 'WSS push (online) or content-free ntfy wake', open_=True))
y += 36
b.append(msg(y, X['s'], X['b2'], 'WSS deliver', open_=True))
y += 28
b.append(self_note(y, X['b1'], 'decrypt locally'))
y += 44
b.append(msg(y, X['b1'], X['s'], 'ACK → envelope deleted', dashed=True))
y += 36
b.append(msg(y, X['b1'], X['a'], 'receipt · an encrypted message, via the server', dashed=True))

b.append(legend(588, W, [(line_sample('accent'), 'Ciphertext fan-out'), (line_sample(), 'Request'),
                          (line_sample('muted', True), 'Reply / receipt'), (box_sample('focal'), 'Never sees plaintext or keys')]))
open('../message-flow.html', 'w').write(page('message-flow', 'Sequence · Convo security', 'How a 1:1 message travels',
    'Ana fetches Bogdan\'s device prekeys, encrypts one Signal ciphertext per device, the server stores and delivers envelopes, each device decrypts locally and acknowledges.',
    W, H, '\n'.join(b),
    'Every device has its own Signal session, so a message is encrypted once per recipient device (and once per sender\'s other device). The server only queues opaque envelopes and deletes them after acknowledgement. Groups use MLS instead: one encryption for the whole group epoch.'))
