from svglib import *

W, H = 1000, 600
b = []
b.append(zone(32, 72, 200, 400, 'INTERNET'))
b.append(zone(272, 72, 200, 400, 'HOME ROUTER · NAT'))
b.append(zone(512, 72, 456, 400, 'K3S NODE 192.168.1.151', security=True))
# arrows
b.append(path('M 208,132 H 536', 'link'))
b.append(label(370, 120, 'HTTPS 443 · NO INBOUND PORT', LINK))
b.append(path('M 704,132 H 744', 'muted', dashed=True))   # cloudflared -> ingress (internal)
b.append(path('M 208,268 H 536', 'accent'))
b.append(label(306, 256, 'UDP 50000-50100', ACCENT))
b.append(label(448, 256, 'TCP 7881', ACCENT))
b.append(path('M 208,380 H 536', 'accent'))
b.append(label(306, 368, 'UDP/TCP 3478', ACCENT))
b.append(label(448, 368, 'UDP 49160-49200', ACCENT))
# nodes
b.append(node(56, 96, 152, 72, 'Cloudflare edge', 'convo · convo-admin', 'external', 'CDN'))
b.append(node(56, 232, 152, 72, 'Phones, browsers', 'call media', 'user', 'CLIENT'))
b.append(node(56, 344, 152, 72, 'NAT-ed clients', 'TURN relay', 'user', 'CLIENT'))
b.append(node(536, 96, 168, 72, 'cloudflared', 'outbound tunnel', 'step', 'POD'))
b.append(node(744, 96, 200, 72, 'ingress-nginx', 'web · admin · keycloak', 'step', 'POD'))
b.append(node(536, 232, 168, 72, 'LiveKit SFU', 'host network', 'focal', 'POD'))
b.append(node(536, 344, 168, 72, 'coturn', 'host network', 'focal', 'POD'))
b.append(node(744, 232, 200, 184, '', None, 'store', 'INTERNAL'))
b.append(f'<text x="844" y="284" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">ClusterIP only</text>')
for i, t in enumerate(['convo-server 8080', 'postgres 5432 · redis 6379', 'minio 9000 · ntfy 80', 'LiveKit API 7880']):
    b.append(f'<text x="844" y="{312 + i * 16}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{t}</text>')
b.append(f'<text x="844" y="400" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">6443 · 22 never forwarded</text>')
b.append(legend(532, W, [(line_sample('link'), 'Tunnel (outbound from cluster)'), (line_sample('accent'), 'Router forward (inbound)'),
                          (box_sample('store'), 'Not reachable from outside')]))
open('../network.html', 'w').write(page('network', 'Deployment · Convo security', 'Network exposure and firewall',
    'HTTPS reaches the cluster only through an outbound Cloudflare tunnel; the router forwards only LiveKit and coturn media ports; databases and the API stay cluster-internal.',
    W, H, '\n'.join(b),
    'No HTTP port is open on the router. Only the call media ports are forwarded to the node (LiveKit and coturn, host networking). Everything else is a ClusterIP service; Kubernetes API and SSH are LAN-only.'))
