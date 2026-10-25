#!/usr/bin/env python3
"""Renders the bundled animated "Convo Moves" pack (Noto Color Emoji art, SIL OFL 1.1) as animated WebP.

Usage: scripts/make-animated-stickers.py public/stickers/moves > manifest.json, then copy the
hashes into src/core/stickers.ts (the client refuses files whose SHA-256 does not match).
Each file is 256x256, 16 frames at 12.5 fps (a 1.28 s loop), at most 128 KiB.
"""
import hashlib, json, math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = sys.argv[1]
EMOJI = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 109)
FRAMES, MS = 16, 80
# id, emoji, motion, alt
STICKERS = [('wave', '👋', 'wiggle', 'Waving hand'), ('heart-beat', '❤️', 'pulse', 'Beating heart'), ('laugh', '😂', 'bounce', 'Laughing'),
            ('party', '🎉', 'pop', 'Party popper'), ('thumbs-up', '👍', 'bounce', 'Thumbs up'), ('fire', '🔥', 'flicker', 'Fire'),
            ('rocket', '🚀', 'launch', 'Rocket'), ('thinking', '🤔', 'tilt', 'Thinking')]

def glyph(emoji):
    g = Image.new('RGBA', (136, 128), (0, 0, 0, 0))
    ImageDraw.Draw(g).text((68, 64), emoji, font=EMOJI, embedded_color=True, anchor='mm')
    return g.crop(g.getbbox()).resize((176, 176), Image.LANCZOS)

def outline(img, width=6):
    alpha = img.split()[3].point(lambda a: 255 if a > 40 else 0)
    grown = alpha.filter(ImageFilter.MaxFilter(width * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    base = Image.new('RGBA', img.size, (255, 255, 255, 0)); base.putalpha(grown)
    out = Image.new('RGBA', img.size, (0, 0, 0, 0)); out.alpha_composite(base); out.alpha_composite(img)
    return out

def frame(g, motion, t):
    a = 2 * math.pi * t
    scale, angle, dx, dy = 1.0, 0.0, 0.0, 0.0
    if motion == 'bounce': dy = -abs(math.sin(a)) * 26; scale = 1 + 0.04 * math.cos(2 * a)
    elif motion == 'wiggle': angle = 18 * math.sin(2 * a)
    elif motion == 'pulse': scale = 1 + 0.14 * max(0, math.sin(2 * a)) ** 3
    elif motion == 'pop': scale = 0.85 + 0.2 * abs(math.sin(a)); angle = 8 * math.sin(a)
    elif motion == 'flicker': scale = 1 + 0.05 * math.sin(3 * a); dy = 3 * math.sin(5 * a)
    elif motion == 'launch': dx = 10 * math.sin(a); dy = -14 * math.sin(a) - 4; angle = -6 * math.sin(a)
    elif motion == 'tilt': angle = 12 * math.sin(a)
    size = int(176 * scale)
    img = g.resize((size, size), Image.LANCZOS).rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(img, (int((256 - img.width) / 2 + dx), int((256 - img.height) / 2 + dy)))
    return outline(canvas)

manifest = []
for sid, emoji, motion, alt in STICKERS:
    g = glyph(emoji)
    frames = [frame(g, motion, i / FRAMES) for i in range(FRAMES)]
    path = f'{OUT}/{sid}.webp'
    frames[0].save(path, 'WEBP', save_all=True, append_images=frames[1:], duration=MS, loop=0, quality=72, method=6)
    data = open(path, 'rb').read()
    manifest.append({'id': sid, 'emoji': emoji, 'alt': alt, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
json.dump(manifest, sys.stdout, ensure_ascii=False)
