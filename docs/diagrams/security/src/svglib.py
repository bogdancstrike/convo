"""Tiny SVG helpers for Convo's docs diagrams (diagram-design skill, Convo profile).

Coordinates are on the 4px grid; connectors are orthogonal with r=8 elbows; labels sit on
opaque paper masks with a gap above their connector. Regenerate with `python3 build.py`.
"""
PAPER, PAPER2, INK, MUTED, SOFT = '#F4F8FA', '#EAF1F5', '#17324D', '#40576E', '#5F7387'
RULE = 'rgba(23,50,77,0.12)'
ACCENT, ACCENT_TINT, LINK = '#1F7FA3', 'rgba(37,150,190,0.10)', '#9A5B12'
SANS, MONO = "'Inter', system-ui, sans-serif", "'Geist Mono', ui-monospace, monospace"

FILLS = {
    'focal': (ACCENT_TINT, ACCENT, '1.2', None),
    'step': ('#ffffff', INK, '1', None),
    'store': ('rgba(23,50,77,0.05)', MUTED, '1', None),
    'external': ('rgba(23,50,77,0.03)', 'rgba(23,50,77,0.30)', '1', None),
    'user': ('rgba(64,87,110,0.10)', SOFT, '1', None),
    'optional': ('rgba(23,50,77,0.02)', 'rgba(23,50,77,0.20)', '1', '4,3'),
}


def defs():
    m = lambda i, c: f'<marker id="{i}" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polygon points="0 0, 8 3, 0 6" fill="{c}"/></marker>'
    return ('<defs>' + m('arrow', MUTED) + m('arrow-accent', ACCENT) + m('arrow-link', LINK)
            + f'<marker id="arrow-open" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto"><polyline points="0 0, 8 3, 0 6" fill="none" stroke="{MUTED}" stroke-width="1.2"/></marker>'
            + '</defs>')


def node(x, y, w, h, name, sub=None, kind='step', tag=None):
    fill, stroke, sw, dash = FILLS[kind]
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{PAPER}"/>',
           f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="6" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>']
    if tag:
        tw = max(28, 4 * round((len(tag) * 5 + 12) / 4))
        out += [f'<rect x="{x + 8}" y="{y + 8}" width="{tw}" height="12" rx="2" fill="none" stroke="{stroke}" stroke-opacity="0.45" stroke-width="0.8"/>',
                f'<text x="{x + 8 + tw / 2}" y="{y + 17}" fill="{stroke}" font-size="7" font-family="{MONO}" text-anchor="middle" letter-spacing="0.08em">{tag}</text>']
    cy = y + h / 2 + (6 if tag else 0)
    out.append(f'<text x="{x + w / 2}" y="{cy + (0 if sub else 4)}" fill="{INK}" font-size="12" font-weight="600" font-family="{SANS}" text-anchor="middle">{name}</text>')
    if sub:
        out.append(f'<text x="{x + w / 2}" y="{cy + 16}" fill="{MUTED}" font-size="9" font-family="{MONO}" text-anchor="middle">{sub}</text>')
    return '\n'.join(out)


def zone(x, y, w, h, label, security=False):
    stroke = 'rgba(31,127,163,0.50)' if security else 'rgba(23,50,77,0.18)'
    fill = 'rgba(31,127,163,0.04)' if security else 'rgba(23,50,77,0.02)'
    lw = 4 * round((len(label) * 5.2 + 16) / 4)
    color = ACCENT if security else 'rgba(23,50,77,0.55)'
    return (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{fill}" stroke="{stroke}" stroke-width="0.8" stroke-dasharray="4,4"/>'
            f'<rect x="{x + 12}" y="{y - 6}" width="{lw}" height="12" rx="2" fill="{PAPER}"/>'
            f'<text x="{x + 12 + lw / 2}" y="{y + 3}" fill="{color}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.12em">{label}</text>')


def path(d, kind='muted', dashed=False, end=True):
    color, marker = {'muted': (MUTED, 'arrow'), 'accent': (ACCENT, 'arrow-accent'), 'link': (LINK, 'arrow-link')}[kind]
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{1 if dashed else 1.2}"'
            + (' stroke-dasharray="5,4"' if dashed else '') + (f' marker-end="url(#{marker})"' if end else '') + '/>')


def label(cx, cy, text, color=SOFT):
    """Arrow label centered at (cx, cy) baseline; mask is 12px tall."""
    w = 4 * round((len(text) * 5.2 + 12) / 4)
    return (f'<rect x="{cx - w / 2}" y="{cy - 9}" width="{w}" height="12" rx="2" fill="{PAPER}"/>'
            f'<text x="{cx}" y="{cy}" fill="{color}" font-size="8" font-family="{MONO}" text-anchor="middle" letter-spacing="0.06em">{text}</text>')


def legend(y, width, items):
    out = [f'<line x1="32" y1="{y - 12}" x2="{width - 32}" y2="{y - 12}" stroke="{RULE}" stroke-width="0.8"/>',
           f'<text x="32" y="{y + 8}" fill="{MUTED}" font-size="8" font-family="{MONO}" letter-spacing="0.14em">LEGEND</text>']
    x = 112
    for sample, text in items:
        out.append(sample(x, y + 4))
        out.append(f'<text x="{x + 40}" y="{y + 8}" fill="{MUTED}" font-size="9" font-family="{SANS}">{text}</text>')
        x += 40 + int(len(text) * 5.6) + 32
    return '\n'.join(out)


def line_sample(kind='muted', dashed=False):
    return lambda x, y: path(f'M {x},{y} H {x + 28}', kind, dashed)


def box_sample(kind):
    def f(x, y):
        fill, stroke, sw, dash = FILLS[kind]
        return f'<rect x="{x}" y="{y - 8}" width="28" height="16" rx="3" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"' + (f' stroke-dasharray="{dash}"' if dash else '') + '/>'
    return f


def zone_sample(security):
    stroke = 'rgba(31,127,163,0.50)' if security else 'rgba(23,50,77,0.18)'
    return lambda x, y: f'<rect x="{x}" y="{y - 8}" width="28" height="16" rx="3" fill="none" stroke="{stroke}" stroke-width="0.8" stroke-dasharray="4,4"/>'


def page(slug, eyebrow, title, desc, width, height, body, caption):
    return f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:ital,wght@0,400;0,500;0,600;1,400&family=Geist+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
    :root {{ --paper: {PAPER}; --ink: {INK}; --muted: {MUTED}; --accent: {ACCENT}; }}
    body {{ font-family: 'Inter', system-ui, sans-serif; background: var(--paper); color: var(--ink); min-height: 100vh;
           display: flex; align-items: center; justify-content: center; padding: 3rem 2rem; }}
    .frame {{ max-width: 1200px; width: 100%; }}
    .eyebrow {{ font-family: 'Geist Mono', monospace; font-size: 0.66rem; font-weight: 500; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.5rem; }}
    h1 {{ font-size: clamp(1.5rem, 2.4vw + 0.75rem, 2rem); font-weight: 600; letter-spacing: -0.02em; line-height: 1.15; margin-bottom: 0.5rem; }}
    .caption {{ color: var(--muted); max-width: 880px; margin-bottom: 1.5rem; line-height: 1.5; }}
    svg {{ width: 100%; min-width: 900px; display: block; }}
  </style>
</head>
<body>
  <div class="frame">
    <p class="eyebrow">{eyebrow}</p>
    <h1>{title}</h1>
    <p class="caption">{caption}</p>
    <svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="{slug}-title {slug}-desc">
      <title id="{slug}-title">{title}</title>
      <desc id="{slug}-desc">{desc}</desc>
      {defs()}
      <rect width="100%" height="100%" fill="{PAPER}"/>
{body}
    </svg>
  </div>
</body>
</html>
'''
