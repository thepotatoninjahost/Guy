#!/usr/bin/env python3
"""
Gunther · brand art forge.

Renders the sculpted crest (the roofline profile, its brass echo, and the
low sun) into every Android asset the app shell needs: adaptive-icon
foregrounds, legacy launcher squares and rounds, and launch splashes at
each density. The geometry is the same profile the web facade draws.

Requires ImageMagick (`convert`). Run once when the mark changes:

    python3 tools/make-brand-art.py
"""

import subprocess
import sys
from pathlib import Path

RES = Path(__file__).resolve().parent.parent / "android" / "app" / "src" / "main" / "res"

SOIL = "#05070c"
BONE = "#e9e2cf"
BRASS = "#f0c26e"
ICE = "#8ce6ff"

# The crest profile, authored in the facade's 1440x200 space (index.html).
PROFILE = [
    ("M", 0, 58),
    ("C", 130, 60, 210, 92, 305, 126),
    ("L", 380, 122),
    ("L", 418, 146),
    ("L", 500, 44),
    ("L", 560, 44),
    ("L", 610, 74),
    ("C", 780, 100, 1010, 150, 1230, 138),
    ("C", 1320, 132, 1390, 126, 1440, 122),
]


def sampled(points, per_curve=28):
    """Flatten cubics into a polyline so ImageMagick can stroke it."""
    out, i = [], 0
    while i < len(points):
        cmd = points[i]
        if cmd[0] == "M":
            out.append((float(cmd[1]), float(cmd[2])))
            i += 1
        elif cmd[0] == "L":
            out.append((float(cmd[1]), float(cmd[2])))
            i += 1
        else:  # C x1 y1 x2 y2 x y
            x1, y1, x2, y2, x3, y3 = (float(v) for v in cmd[1:])
            x0, y0 = out[-1]
            for k in range(1, per_curve + 1):
                t = k / per_curve
                mt = 1 - t
                x = mt**3 * x0 + 3 * mt**2 * t * x1 + 3 * mt * t**2 * x2 + t**3 * x3
                y = mt**3 * y0 + 3 * mt**2 * t * y1 + 3 * mt * t**2 * y2 + t**3 * y3
                out.append((x, y))
            i += 1
    return out


PATH = sampled(PROFILE)
X0, X1 = min(p[0] for p in PATH), max(p[0] for p in PATH)
Y0, Y1 = min(p[1] for p in PATH), max(p[1] for p in PATH)


def fit(points, size, cx, cy, width_frac=0.62):
    """Scale the crest into a `size`-square canvas, centered at (cx, cy)."""
    scale = size * width_frac / (X1 - X0)
    w, h = (X1 - X0) * scale, (Y1 - Y0) * scale
    ox, oy = cx - w / 2, cy - h / 2
    return [(ox + (x - X0) * scale, oy + (y - Y0) * scale) for x, y in points]


def stroke(points):
    return "polyline " + " ".join(f"{x:.1f},{y:.1f}" for x, y in points)


def run(args):
    r = subprocess.run(["convert"] + args, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"convert failed: {r.stderr[:400]}")


def crest_layers(size, cx, cy, width_frac=0.62, lw=0.014, echo_lw=0.007, with_sun=True):
    """Draw commands for mark + brass echo + sun at a given center."""
    pts = fit(PATH, size, cx, cy, width_frac)
    dy = (Y1 - Y0) * (size * width_frac / (X1 - X0)) * 0.16  # echo offset, like +16y
    out = []
    if with_sun:
        sun_r = size * 0.055
        sx, sy = cx - size * width_frac * 0.26, cy - size * 0.10
        out.append(f"stroke none fill '{BRASS}70' circle {sx:.1f},{sy - sun_r:.1f} {sx:.1f},{sy:.1f}")
        out.append(f"stroke none fill '{BRASS}40' circle {sx:.1f},{sy - sun_r * 1.9:.1f} {sx:.1f},{sy:.1f}")
        sun_r2 = size * 0.038
        out.append(f"stroke none fill '{BRASS}' circle {sx:.1f},{sy - sun_r2:.1f} {sx:.1f},{sy:.1f}")
    out.append(f"stroke '{BRASS}' stroke-width {max(1, size * echo_lw):.1f} fill none "
               + stroke([(x, y + dy) for x, y in pts]))
    out.append(f"stroke '{BONE}' stroke-width {max(1.5, size * lw):.1f} fill none "
               + stroke(pts))
    return out


def mipmap(dirname, sizes):
    d = RES / dirname
    d.mkdir(parents=True, exist_ok=True)
    return d, sizes


def main():
    if not RES.exists():
        raise SystemExit(f"no android res at {RES}")

    # ---- adaptive foreground: mark on transparent, 10x canvas per 108dp
    master = 1080
    fg = Path("/tmp/gunther_fg_master.png")
    run(["-size", f"{master}x{master}", "xc:none",
         *sum([["-draw", c] for c in crest_layers(master, master / 2, master / 2,
                                                   width_frac=0.46, lw=0.013, echo_lw=0.006)], []),
         str(fg)])
    for dens, px in [("mdpi", 108), ("hdpi", 162), ("xhdpi", 216), ("xxhdpi", 324), ("xxxhdpi", 432)]:
        d = RES / f"mipmap-{dens}"
        d.mkdir(parents=True, exist_ok=True)
        run([str(fg), "-resize", f"{px}x{px}", str(d / "ic_launcher_foreground.png")])

    # ---- legacy full-bleed squares + rounds: soil glass, faint blueprint grid, mark
    leg = Path("/tmp/gunther_legacy_master.png")
    M = 512
    grid = []
    for g in range(1, 8):
        p = M * g / 8
        grid.append(f"stroke '{BONE}14' stroke-width 1 fill none line {p:.0f},0 {p:.0f},{M}")
        grid.append(f"stroke '{BONE}14' stroke-width 1 fill none line 0,{p:.0f} {M},{p:.0f}")
    horizon = f"stroke '{ICE}22' stroke-width 3 stroke-dasharray 14,12 fill none line 0,{M * 0.78:.0f} {M},{M * 0.78:.0f}"
    run(["-size", f"{M}x{M}", f"gradient:{SOIL}-#0b1018",
         *sum([["-draw", c] for c in grid + [horizon]], []),
         *sum([["-draw", c] for c in crest_layers(M, M / 2, M * 0.47,
                                                   width_frac=0.72, lw=0.011, echo_lw=0.005)], []),
         str(leg)])
    mask = Path("/tmp/gunther_circle.png")
    resized = Path("/tmp/gunther_legacy_sq.png")
    for dens, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        d = RES / f"mipmap-{dens}"
        run([str(leg), "-resize", f"{px}x{px}", str(resized)])
        run([str(resized), str(d / "ic_launcher.png")])
        run(["-size", f"{px}x{px}", "xc:none",
             "-draw", f"fill white stroke none circle {px / 2:.0f},{px / 2:.0f} {px / 2:.0f},0",
             "-alpha", "off", str(mask)])
        run([str(resized), "(", str(mask), ")",
             "-compose", "DstIn", "-composite",
             str(d / "ic_launcher_round.png")])

    # ---- launch splashes: soil field, mark + horizon, at each density box.
    # The mark is drawn on a transparent master so it can be floated over the
    # target gradient without a seam.
    splash_mark = Path("/tmp/gunther_splash.png")
    run(["-size", "2000x2000", "xc:none",
         *sum([["-draw", c] for c in crest_layers(2000, 1000, 940,
                                                   width_frac=0.60, lw=0.010, echo_lw=0.0045)], []),
         "-draw", f"stroke '{ICE}1c' stroke-width 5 stroke-dasharray 26,22 fill none line 260,1260 1740,1240",
         str(splash_mark)])

    def splash(w, h, out):
        # background gradient then overlay the centered mark (fit, not crop)
        bg = Path("/tmp/gunther_splash_bg.png")
        run(["-size", f"{w}x{h}", f"gradient:{SOIL}-#020409", str(bg)])
        side = int(min(w, h) * 0.74)
        mark = Path("/tmp/gunther_splash_m.png")
        run([str(splash_mark), "-resize", f"{side}x{side}", str(mark)])
        run([str(bg), str(mark), "-gravity", "center",
             "-geometry", f"+0{-int(h * 0.06)}", "-compose", "over", "-composite", str(out)])

    port = [("mdpi", 320, 480), ("hdpi", 480, 800), ("xhdpi", 720, 1280),
            ("xxhdpi", 960, 1600), ("xxxhdpi", 1280, 1920)]
    for dens, w, h in port:
        d = RES / f"drawable-port-{dens}"
        d.mkdir(parents=True, exist_ok=True)
        splash(w, h, d / "splash.png")
    for dens, w, h in [(dens, h, w) for dens, w, h in port]:
        d = RES / f"drawable-land-{dens}"
        d.mkdir(parents=True, exist_ok=True)
        splash(w, h, d / "splash.png")
    RES.joinpath("drawable").mkdir(exist_ok=True)
    splash(480, 320, RES / "drawable" / "splash.png")

    print("brand art forged into", RES)


if __name__ == "__main__":
    main()
