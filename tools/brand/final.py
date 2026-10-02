"""Final VeriQall brand files: flattened paths (no masks/strokes) so they work everywhere."""
import os, io, math, zipfile
import pathops, cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import make_brand as m

C = m.C
OUT = "out"
os.makedirs(OUT, exist_ok=True)


import tune
TA = tune.T["A tail-hake"]


def word_paths():
    return tune.word(TA)


def svg(vb, inner, w, h, title="VeriQall"):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb[0]:.0f} {vb[1]:.0f} {vb[2]:.0f} {vb[3]:.0f}" '
            f'width="{w:.0f}" height="{h:.0f}" role="img" aria-label="{title}"><title>{title}</title>{inner}</svg>\n')


letters, qword, wbox = word_paths()
pad = (wbox[3] - wbox[1]) * 0.02
wvb = (wbox[0] - pad, wbox[1] - pad, wbox[2] - wbox[0] + 2 * pad, wbox[3] - wbox[1] + 2 * pad)
WH = 48
for mode, (t, q) in {"light": (C["ink"], C["brand"]), "dark": (C["mist"], C["brand_dk"])}.items():
    inner = f'<path fill="{t}" d="{letters}"/><path fill="{q}" d="{qword}"/>'
    open(f"{OUT}/veriqall-logo-{mode}.svg", "w").write(svg(wvb, inner, WH * wvb[2] / wvb[3], WH))

# Symbol: optically centred between bowl centre and full bounds
qd, qb = tune.q(0, TA)
bcx, bcy = (m.OB[0] + m.OB[2]) / 2, -(m.OB[1] + m.OB[3]) / 2
ocx = (bcx + (qb[0] + qb[2]) / 2) / 2
ocy = (bcy + (qb[1] + qb[3]) / 2) / 2
half = max(qb[2] - ocx, ocx - qb[0], qb[3] - ocy, ocy - qb[1])


def sq(scale_pad):
    hh = half * scale_pad
    return (ocx - hh, ocy - hh, 2 * hh, 2 * hh)


svb = sq(1.06)
for mode, q in {"light": C["brand"], "dark": C["brand_dk"]}.items():
    open(f"{OUT}/veriqall-symbol-{mode}.svg", "w").write(svg(svb, f'<path fill="{q}" d="{qd}"/>', 64, 64))

avb = sq(1.62)
r = avb[2] * 0.2237
app = (f'<rect x="{avb[0]:.0f}" y="{avb[1]:.0f}" width="{avb[2]:.0f}" height="{avb[3]:.0f}" rx="{r:.0f}" fill="{C["brand"]}"/>'
       f'<path fill="{C["white"]}" d="{qd}"/>')
app_svg = svg(avb, app, 512, 512)
open(f"{OUT}/veriqall-app-icon.svg", "w").write(app_svg)
fav = (f'<style>path{{fill:{C["brand"]}}}@media (prefers-color-scheme:dark){{path{{fill:{C["brand_dk"]}}}}}</style>'
       f'<path d="{qd}"/>')
open(f"{OUT}/favicon.svg", "w").write(svg(sq(1.02), fav, 32, 32))

# PNG icons for iPhone/iPad home screen and Android/PWA (full-bleed square, OS rounds corners)
full = svg(avb, f'<rect x="{avb[0]:.0f}" y="{avb[1]:.0f}" width="{avb[2]:.0f}" height="{avb[3]:.0f}" fill="{C["brand"]}"/>'
           f'<path fill="{C["white"]}" d="{qd}"/>', 512, 512)
cairosvg.svg2png(bytestring=full.encode(), write_to=f"{OUT}/apple-touch-icon.png", output_width=180, output_height=180)
cairosvg.svg2png(bytestring=full.encode(), write_to=f"{OUT}/icon-512.png", output_width=512, output_height=512)

# ---------- preview sheet ----------
def put(inner, vb, x, y, w, h):
    s = min(w / vb[2], h / vb[3])
    dx, dy = x + (w - vb[2] * s) / 2, y + (h - vb[3] * s) / 2
    return f'<g transform="translate({dx:.1f},{dy:.1f}) scale({s:.5f}) translate({-vb[0]:.0f},{-vb[1]:.0f})">{inner}</g>'


def txt(x, y, s, col, size=17, w=400):
    return f'<text x="{x}" y="{y}" font-family="Schibsted Grotesk, DejaVu Sans" font-size="{size}" font-weight="{w}" fill="{col}">{s}</text>'


W = 1200
p = [f'<rect width="{W}" height="1180" fill="#E6E6EE"/>']
p.append(f'<rect x="40" y="40" width="1120" height="300" rx="20" fill="{C["paper"]}"/>')
p.append(put(f'<path fill="{C["ink"]}" d="{letters}"/><path fill="{C["brand"]}" d="{qword}"/>', wvb, 140, 90, 920, 200))
p.append(f'<rect x="40" y="360" width="1120" height="300" rx="20" fill="{C["night"]}"/>')
p.append(put(f'<path fill="{C["mist"]}" d="{letters}"/><path fill="{C["brand_dk"]}" d="{qword}"/>', wvb, 140, 410, 920, 200))
# icon row
p.append(f'<rect x="40" y="680" width="550" height="230" rx="20" fill="{C["paper"]}"/>')
p.append(f'<rect x="610" y="680" width="550" height="230" rx="20" fill="{C["night"]}"/>')
for x0, col, bg in ((40, C["brand"], C["paper"]), (610, C["brand_dk"], C["night"])):
    sym = f'<path fill="{col}" d="{qd}"/>'
    p.append(put(sym, svb, x0 + 40, 715, 160, 160))
    p.append(put(sym, svb, x0 + 240, 779, 32, 32))
    p.append(put(sym, svb, x0 + 300, 787, 16, 16))
p.append(put(app, avb, 405, 725, 140, 140))
p.append(put(app, avb, 975, 725, 140, 140))
# palette
sw = [("Stempel", C["brand"]), ("Stempel lys", C["brand_dk"]), ("Skrift", C["ink"]),
      ("Papir", C["paper"]), ("Natt", C["night"]), ("Tåke", C["mist"]),
      ("Godkjent", C["ok"]), ("Avvik", C["warn"]), ("Brudd", C["bad"])]
p.append(f'<rect x="40" y="930" width="1120" height="210" rx="20" fill="{C["paper"]}"/>')
for i, (n, col) in enumerate(sw):
    x = 70 + i * 120
    p.append(f'<rect x="{x}" y="960" width="96" height="96" rx="14" fill="{col}" stroke="#D4D4DE"/>')
    p.append(txt(x, 1082, n, C["ink"], 16, 600))
    p.append(txt(x, 1104, col.upper(), "#5B5E78", 14))
sheet = f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="1180">' + "".join(p) + "</svg>"
cairosvg.svg2png(bytestring=sheet.encode(), write_to=f"{OUT}/veriqall-brand-preview.png", output_width=W)

with zipfile.ZipFile(f"{OUT}/veriqall-brand.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for f in sorted(os.listdir(OUT)):
        if f != "veriqall-brand.zip":
            z.write(f"{OUT}/{f}", f"veriqall-brand/{f}")
print(sorted(os.listdir(OUT)))
for f in sorted(os.listdir(OUT)):
    print(f, os.path.getsize(f"{OUT}/{f}"))
