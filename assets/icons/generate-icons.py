#!/usr/bin/env python3
"""Generiert die PWA-App-Icons aus einer einzigen Vektor-Zeichnung.

Kein externes Icon-Set nötig: zeichnet einen stilisierten Globus
(Breiten-/Längengrade + Sensor-Ring) in den ARGUS-Markenfarben
direkt mit Pillow. Bei Änderungen am Branding einfach erneut
ausführen: `python3 assets/icons/generate-icons.py`
"""

import math
import os

from PIL import Image, ImageDraw

BG = (11, 14, 20, 255)       # --bg-dark
ACCENT = (56, 189, 248, 255)  # --accent
ACCENT_DIM = (56, 189, 248, 110)
WHITE = (236, 240, 245, 255)

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# Alle Größen, die manifest.json / index.html referenzieren.
SIZES = [16, 32, 72, 96, 128, 144, 152, 180, 192, 384, 512]
MASKABLE_SIZES = [192, 512]


def draw_globe(size, margin_ratio, maskable=False):
    """Zeichnet den Globus bei hoher Auflösung (4x) und skaliert runter (Antialiasing).

    Maskable Icons müssen randlos (voller Hintergrund bis zum Rand) sein, da
    Android selbst eine Form (Kreis, Squircle, ...) darüberlegt — eigene
    abgerundete Ecken würden dann als transparente Lücken durchscheinen.
    """
    scale = 4
    s = size * scale
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    cx = cy = s / 2
    margin = s * margin_ratio
    r = s / 2 - margin

    if maskable:
        draw.rectangle([0, 0, s - 1, s - 1], fill=BG)
    else:
        corner = s * 0.22
        draw.rounded_rectangle([0, 0, s - 1, s - 1], radius=corner, fill=BG)

    # Äußerer Sensor-Ring
    ring_w = max(2 * scale, int(s * 0.012))
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ACCENT, width=ring_w)

    # Breitengrade (Ellipsen, die mit der Kugelform perspektivisch schmaler werden)
    lat_w = max(1 * scale, int(s * 0.006))
    for frac in (0.0, 0.45, -0.45):
        ry = r * (1 - abs(frac) * 0.15)
        cy_lat = cy + frac * r * 0.9
        rx = r * math.sqrt(max(0.0001, 1 - (frac * 0.9) ** 2)) if abs(frac) < 1 else 0
        if rx > 1:
            draw.ellipse(
                [cx - rx, cy_lat - ry * 0.28, cx + rx, cy_lat + ry * 0.28],
                outline=ACCENT_DIM, width=lat_w,
            )

    # Längengrade (vertikale Ellipsenbögen)
    for rx_frac in (1.0, 0.55):
        rx = r * rx_frac
        draw.ellipse([cx - rx, cy - r, cx + rx, cy + r], outline=ACCENT_DIM, width=lat_w)

    # Zentraler Punkt (Sensor/Standort-Marker)
    dot_r = r * 0.1
    draw.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=WHITE)

    # Kleiner Orbit-Punkt oben rechts (deutet Satelliten/Überwachung an)
    orbit_r = r * 1.3
    ox = cx + orbit_r * math.cos(math.radians(-35))
    oy = cy + orbit_r * math.sin(math.radians(-35))
    sat_r = s * 0.035
    if 0 <= ox <= s and 0 <= oy <= s:
        draw.ellipse([ox - sat_r, oy - sat_r, ox + sat_r, oy + sat_r], fill=ACCENT)

    return img.resize((size, size), Image.LANCZOS)


def save(img, name):
    path = os.path.join(OUT_DIR, name)
    img.save(path, "PNG")
    print(f"  {name}  ({img.size[0]}x{img.size[1]})")


def main():
    print("Standard-Icons (Vollflächig mit kleinem Rand):")
    for size in SIZES:
        img = draw_globe(size, margin_ratio=0.08)
        save(img, f"icon-{size}.png")

    # apple-touch-icon: keine Transparenz (iOS legt sonst Weiß/Schwarz dahinter)
    apple = draw_globe(180, margin_ratio=0.08).convert("RGB")
    save(apple, "apple-touch-icon.png")

    # favicon.ico aus den kleinen Größen
    icon16 = draw_globe(16, margin_ratio=0.08)
    icon32 = draw_globe(32, margin_ratio=0.08)
    icon16.save(os.path.join(OUT_DIR, "favicon.ico"), format="ICO", sizes=[(16, 16), (32, 32)])
    print("  favicon.ico")

    print("Maskable Icons (größerer Sicherheitsrand für adaptive Android-Icon-Formen):")
    for size in MASKABLE_SIZES:
        img = draw_globe(size, margin_ratio=0.22, maskable=True)
        save(img, f"icon-maskable-{size}.png")


if __name__ == "__main__":
    main()
