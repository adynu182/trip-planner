#!/usr/bin/env python3
"""Generate PWA icon set (gradient brand + GPS pin glyph) for GPSLive-Tracker.
Bukan bagian dari build app — cuma dijalankan sekali secara manual buat
generate aset di public/. Boleh dihapus / re-run kalau mau ganti desain.
"""
import numpy as np
from PIL import Image, ImageDraw

OUT = "/home/claude/GPSLive-Tracker/public"

# Warna brand (samain sama --accent / --accent2 di style.css)
C1 = (24, 122, 125)    # #187a7d  accent (top-left)
C2 = (43, 154, 157)    # #2b9a9d  accent2 (bottom-right)
WHITE = (255, 255, 255, 255)
DOT = (14, 22, 33, 255)  # #0e1621  dark navy, biar dot pin kontras

SS = 4  # supersampling factor buat anti-alias


def gradient_bg(size):
    """Diagonal linear gradient C1 -> C2, return RGBA ndarray image."""
    ys, xs = np.mgrid[0:size, 0:size]
    t = (xs.astype(np.float32) + ys.astype(np.float32)) / (2 * (size - 1))
    t = t[..., None]
    c1 = np.array(C1, dtype=np.float32)
    c2 = np.array(C2, dtype=np.float32)
    rgb = c1 * (1 - t) + c2 * t
    rgba = np.dstack([rgb, np.full((size, size, 1), 255, dtype=np.float32)])
    return Image.fromarray(rgba.astype(np.uint8), mode="RGBA")


def draw_pin(img, cx, cy, scale):
    """Gambar pin lokasi putih + dot gelap di tengahnya, di atas img (in-place)."""
    d = ImageDraw.Draw(img)
    r = scale * 0.30          # radius kepala pin
    tip_extra = scale * 0.62  # seberapa jauh ujung pin dari pusat kepala

    # Kepala pin (lingkaran)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=WHITE)
    # Ujung pin (segitiga menyatu ke bawah lingkaran)
    tri_half = r * 0.86
    d.polygon(
        [
            (cx - tri_half, cy + r * 0.42),
            (cx + tri_half, cy + r * 0.42),
            (cx, cy + tip_extra),
        ],
        fill=WHITE,
    )
    # Dot tengah (lubang) — warna gelap solid biar selalu kontras
    rd = r * 0.42
    d.ellipse([cx - rd, cy - rd, cx + rd, cy + rd], fill=DOT)


def make_icon(size, safe_scale, filename, corner_radius_pct=0.0):
    ss_size = size * SS
    img = gradient_bg(ss_size)

    if corner_radius_pct > 0:
        rad = int(ss_size * corner_radius_pct)
        mask = Image.new("L", (ss_size, ss_size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, ss_size - 1, ss_size - 1], radius=rad, fill=255
        )
        bg = Image.new("RGBA", (ss_size, ss_size), (0, 0, 0, 0))
        bg.paste(img, (0, 0), mask)
        img = bg

    glyph_scale = ss_size * safe_scale
    draw_pin(img, ss_size / 2, ss_size / 2 - glyph_scale * 0.06, glyph_scale)

    img = img.resize((size, size), Image.LANCZOS)
    img.save(f"{OUT}/{filename}")
    print(f"✓ {filename} ({size}x{size})")


if __name__ == "__main__":
    # "any" purpose — full-bleed, glyph agak besar (dipakai splash/desktop/list)
    make_icon(192, safe_scale=0.42, filename="icon-192.png")
    make_icon(512, safe_scale=0.42, filename="icon-512.png")
    # "maskable" — background WAJIB penuh (no rounding), glyph dikecilkan
    # supaya tetap utuh kalau di-crop lingkaran/squircle oleh launcher Android.
    make_icon(512, safe_scale=0.30, filename="icon-maskable-512.png")
    # Apple touch icon — iOS auto-round sendiri, full-bleed square juga.
    make_icon(180, safe_scale=0.42, filename="apple-touch-icon.png")
    # Favicon tab browser (kecil, glyph diperbesar dikit biar kebaca di 32px)
    make_icon(48, safe_scale=0.44, filename="favicon.png")
