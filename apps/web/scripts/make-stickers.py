#!/usr/bin/env python3
"""Renders the bundled "Convo Basics" sticker pack (Noto Color Emoji art, SIL OFL 1.1) as 256px WebP.

Usage: scripts/make-stickers.py public/stickers/basics > manifest.json, then copy the hashes into
src/core/stickers.ts (the client refuses sticker files whose SHA-256 does not match).
"""
import hashlib, json, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT = sys.argv[1]
EMOJI = ImageFont.truetype('/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf', 109)
TEXT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
STICKERS = [  # id, emoji, caption, alt text (en)
    ('thumbs-up', '👍', 'OK!', 'Thumbs up'), ('heart', '❤️', None, 'Red heart'), ('laugh', '😂', 'LOL', 'Laughing'),
    ('thanks', '🙏', 'Thanks!', 'Thank you'), ('party', '🎉', 'Congrats!', 'Party popper'), ('coffee', '☕', 'Coffee?', 'Coffee'),
    ('thinking', '🤔', 'Hmm…', 'Thinking'), ('wave', '👋', 'Hi!', 'Waving hand'), ('fire', '🔥', None, 'Fire'),
    ('clap', '👏', 'Bravo', 'Clapping'), ('sleepy', '😴', 'Later', 'Sleeping'), ('rocket', '🚀', 'Ship it', 'Rocket'),
    ('cool', '😎', None, 'Cool'), ('hug', '🤗', 'Hug', 'Hug'), ('check', '✅', 'Done', 'Done'), ('sorry', '😅', 'Oops', 'Oops'),
]
def outline(img, width):
    alpha = img.split()[3].point(lambda a: 255 if a > 40 else 0)
    grown = alpha.filter(ImageFilter.MaxFilter(width * 2 + 1)).filter(ImageFilter.GaussianBlur(1.2))
    base = Image.new('RGBA', img.size, (255, 255, 255, 0)); base.putalpha(grown)
    shadow = Image.new('RGBA', img.size, (0, 0, 0, 0)); shadow.putalpha(grown.point(lambda a: a * 0.25).filter(ImageFilter.GaussianBlur(4)))
    out = Image.new('RGBA', img.size, (0, 0, 0, 0)); out.alpha_composite(shadow, (0, 3)); out.alpha_composite(base); out.alpha_composite(img)
    return out
manifest = []
for sid, emoji, caption, alt in STICKERS:
    glyph = Image.new('RGBA', (136, 128), (0, 0, 0, 0))
    ImageDraw.Draw(glyph).text((68, 64), emoji, font=EMOJI, embedded_color=True, anchor='mm')
    glyph = glyph.crop(glyph.getbbox()).resize((176 if caption else 196,) * 2, Image.LANCZOS)
    canvas = Image.new('RGBA', (256, 256), (0, 0, 0, 0))
    canvas.alpha_composite(glyph, ((256 - glyph.width) // 2, 14 if caption else 30))
    if caption:
        d = ImageDraw.Draw(canvas)
        w = d.textlength(caption, font=TEXT)
        d.rounded_rectangle(((256 - w) / 2 - 14, 190, (256 + w) / 2 + 14, 236), 18, fill=(28, 120, 148, 255))
        d.text((128, 213), caption, font=TEXT, fill='white', anchor='mm')
    sticker = outline(canvas, 6)
    path = f'{OUT}/{sid}.webp'
    sticker.save(path, 'WEBP', lossless=True, quality=100, method=6)
    data = open(path, 'rb').read()
    manifest.append({'id': sid, 'emoji': emoji, 'alt': alt, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
json.dump(manifest, sys.stdout, ensure_ascii=False)
