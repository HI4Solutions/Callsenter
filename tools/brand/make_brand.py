#!/usr/bin/env python3
"""VeriQall brand generator.
Custom Q whose tail is a check mark + wordmark set in Schibsted Grotesk (OFL).
Usage: python3 make_brand.py sheet          -> variants sheet for review
       python3 make_brand.py final <VARIANT> -> final SVG files + preview
"""
import math, sys, os
import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen
import cairosvg

C = dict(ink="#15172E", paper="#FAFAFC", night="#10122A", mist="#ECECF6",
         brand="#3326C9", brand_dk="#A39BFF", white="#FFFFFF",
         ok="#1E9E5A", warn="#E0A100", bad="#D7382F")

VARIANTS = {
    # vx/vy: vertex pos (vx * bowl radius right of centre, vy * glyph height below baseline)
    # a1/a2: short/long arm angles; L1/L2: arm lengths as share of glyph height; knock: gap where check crosses bowl
    "Q1": dict(vx=0.55, vy=0.12, a1=45, a2=58, L1=0.42, L2=0.60, knock=0.0),
    "Q2": dict(vx=0.55, vy=0.12, a1=45, a2=58, L1=0.42, L2=0.60, knock=0.38),
    "Q3": dict(vx=0.30, vy=-0.02, a1=45, a2=55, L1=0.30, L2=0.95, knock=0.38),
}

WGHT = 800
vf = TTFont("SG.ttf")
instantiateVariableFont(vf, {"wght": WGHT}, inplace=False).save("SG-static.ttf")
font = TTFont("SG-static.ttf")
gs, order, cmap = font.getGlyphSet(), font.getGlyphOrder(), font.getBestCmap()
hmtx = font["hmtx"]


def gn(ch):
    return cmap[ord(ch)]


def raw_bounds(g):
    bp = BoundsPen(gs)
    gs[g].draw(bp)
    return bp.bounds


OB = raw_bounds(gn("O"))


def measure_o():
    from PIL import Image
    import io
    x0, y0, x1, y1 = OB
    d = gpath(gn("O"), 0)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x0} {-y1} {x1-x0} {y1-y0}" '
           f'width="{x1-x0}" height="{y1-y0}"><path d="{d}" fill="#000"/></svg>')
    im = Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert("LA")
    w, h = im.size
    ink = lambda x, y: im.getpixel((x, y))[1] > 128
    side = 0
    while ink(side, h // 2):
        side += 1
    bot = 0
    while ink(w // 2, h - 1 - bot):
        bot += 1
    return side, bot
O_ADV = hmtx[gn("O")][0]
O_RSB = O_ADV - OB[2]

hbf = hb.Font(hb.Face(hb.Blob.from_file_path("SG-static.ttf")))
SIDE, BOT = None, None
_MID = [0]


def shape(text):
    buf = hb.Buffer()
    buf.add_str(text)
    buf.guess_segment_properties()
    hb.shape(hbf, buf, {"kern": True, "liga": True})
    out, x = [], 0
    for i, p in zip(buf.glyph_infos, buf.glyph_positions):
        out.append((order[i.codepoint], x + p.x_offset))
        x += p.x_advance
    return out, x


def gpath(g, dx):
    pen = SVGPathPen(gs)
    gs[g].draw(TransformPen(pen, (1, 0, 0, -1, dx, 0)))
    return pen.getCommands()


def gbox(g, dx):
    b = raw_bounds(g)
    return None if b is None else (b[0] + dx, -b[3], b[2] + dx, -b[1])


def union(boxes):
    boxes = [b for b in boxes if b]
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def norm(v):
    l = math.hypot(*v)
    return (v[0] / l, v[1] / l)


def q_geom(ox, P):
    global SIDE, BOT
    if SIDE is None:
        SIDE, BOT = measure_o()
    x0, y0, x1, y1 = OB
    h = y1 - y0
    csw = SIDE * P.get("check_k", 0.92)
    cx, cy = ox + (x0 + x1) / 2, -(y0 + y1) / 2
    rx, ry = (x1 - x0 - SIDE) / 2, (y1 - y0 - BOT) / 2
    vx, vy = cx + rx * P["vx"], -y0 + h * P["vy"]
    a1, a2 = math.radians(P["a1"]), math.radians(P["a2"])
    s = (vx - h * P["L1"] * math.cos(a1), vy - h * P["L1"] * math.sin(a1))
    e = (vx + h * P["L2"] * math.cos(a2), vy - h * P["L2"] * math.sin(a2))
    u1, u2 = norm((s[0] - vx, s[1] - vy)), norm((e[0] - vx, e[1] - vy))
    theta = math.acos(max(-1, min(1, u1[0] * u2[0] + u1[1] * u2[1])))
    bis = norm((u1[0] + u2[0], u1[1] + u2[1]))
    m = (csw / 2) / math.sin(theta / 2)
    pts = [(vx - bis[0] * m, vy - bis[1] * m)]
    for p, u in ((s, u1), (e, u2)):
        perp = (-u[1], u[0])
        pts += [(p[0] + perp[0] * csw / 2, p[1] + perp[1] * csw / 2),
                (p[0] - perp[0] * csw / 2, p[1] - perp[1] * csw / 2)]
    cbox = (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts))
    rbox = (ox + x0, -y1, ox + x1, -y0)
    return dict(ox=ox, cx=cx, cy=cy, rx=rx, ry=ry, csw=csw, s=s, v=(vx, vy), e=e,
                knock=P.get("knock", 0.0), box=union([cbox, rbox]))


def q_svg(g, ring, check, cls=None):
    s, v, e = g["s"], g["v"], g["e"]
    a = f' class="{cls}"' if cls else ""
    pts = f'{s[0]:.0f},{s[1]:.0f} {v[0]:.0f},{v[1]:.0f} {e[0]:.0f},{e[1]:.0f}'
    bowl = gpath(gn("O"), g["ox"])
    out = ""
    mask = ""
    if g["knock"] > 0:
        _MID[0] += 1
        mid = f"vqk{_MID[0]}"
        b = g["box"]
        gap = g["csw"] * (1 + 2 * g["knock"])
        out += (f'<defs><mask id="{mid}" maskUnits="userSpaceOnUse" x="{b[0]-400:.0f}" y="{b[1]-400:.0f}" '
                f'width="{b[2]-b[0]+800:.0f}" height="{b[3]-b[1]+800:.0f}">'
                f'<rect x="{b[0]-400:.0f}" y="{b[1]-400:.0f}" width="{b[2]-b[0]+800:.0f}" height="{b[3]-b[1]+800:.0f}" fill="#fff"/>'
                f'<polyline points="{pts}" fill="none" stroke="#000" stroke-width="{gap:.0f}" '
                f'stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="8"/></mask></defs>')
        mask = f' mask="url(#{mid})"'
    out += f'<path{a} d="{bowl}" fill="{ring}"{mask}/>'
    out += (f'<polyline{a} points="{pts}" fill="none" stroke="{check}" stroke-width="{g["csw"]:.0f}" '
            f'stroke-linecap="butt" stroke-linejoin="miter" stroke-miterlimit="8"/>')
    return out


def wordmark(P, text_col, q_col, text_cls=None, q_cls=None):
    left, wl = shape("Veri")
    right, wr = shape("all")
    t = f' class="{text_cls}"' if text_cls else ""
    els, boxes = [], []
    for g, x in left:
        els.append(f'<path{t} d="{gpath(g, x)}" fill="{text_col}"/>')
        boxes.append(gbox(g, x))
    q = q_geom(wl, P)
    els.append(q_svg(q, q_col, q_col, q_cls))
    boxes.append(q["box"])
    x_all = max(q["box"][2], wl + OB[2]) + O_RSB * P.get("gap_k", 0.9)
    for g, x in right:
        els.append(f'<path{t} d="{gpath(g, x_all + x)}" fill="{text_col}"/>')
        boxes.append(gbox(g, x_all + x))
    return "".join(els), union(boxes)


def icon(P, col, cls=None):
    q = q_geom(0, P)
    return q_svg(q, col, col, cls), q["box"]


def place(inner, box, x, y, w, h):
    bx0, by0, bx1, by1 = box
    bw, bh = bx1 - bx0, by1 - by0
    s = min(w / bw, h / bh)
    dx, dy = x + (w - bw * s) / 2, y + (h - bh * s) / 2
    return (f'<g transform="translate({dx:.2f},{dy:.2f}) scale({s:.5f}) '
            f'translate({-bx0:.1f},{-by0:.1f})">{inner}</g>')


def square_box(box, pad):
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    side = max(x1 - x0, y1 - y0) * (1 + 2 * pad)
    return (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)


def label(x, y, text, col, size=15, weight=400):
    return (f'<text x="{x}" y="{y}" font-family="DejaVu Sans" font-size="{size}" '
            f'font-weight="{weight}" fill="{col}">{text}</text>')


def sheet():
    W, rowh = 1200, 210
    parts = [f'<rect width="{W}" height="{60 + rowh * len(VARIANTS)}" fill="#E4E4EC"/>']
    y = 30
    for name, P in VARIANTS.items():
        parts.append(label(30, y + 10, name, C["ink"], 18, 700))
        parts.append(f'<rect x="30" y="{y + 20}" width="440" height="170" rx="14" fill="{C["paper"]}"/>')
        parts.append(f'<rect x="490" y="{y + 20}" width="440" height="170" rx="14" fill="{C["night"]}"/>')
        wl, wb = wordmark(P, C["ink"], C["brand"])
        parts.append(place(wl, wb, 60, y + 55, 380, 100))
        wd, _ = wordmark(P, C["mist"], C["brand_dk"])
        parts.append(place(wd, wb, 520, y + 55, 380, 100))
        il, ib = icon(P, C["brand"])
        sq = square_box(ib, 0.08)
        parts.append(f'<rect x="950" y="{y + 20}" width="220" height="170" rx="14" fill="{C["paper"]}"/>')
        parts.append(place(il, sq, 965, y + 45, 110, 110))
        parts.append(place(il, sq, 1090, y + 70, 32, 32))
        parts.append(place(il, sq, 1135, y + 78, 16, 16))
        y += rowh
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{60 + rowh * len(VARIANTS)}">'
           + "".join(parts) + "</svg>")
    cairosvg.svg2png(bytestring=svg.encode(), write_to="sheet.png", output_width=W)
    print("SIDE", SIDE, "BOT", BOT, "O", OB)


if __name__ == "__main__":
    if sys.argv[1] == "sheet":
        sheet()
