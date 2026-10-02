import math, pathops, cairosvg
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import make_brand as m
C = m.C
SIDE, BOT = m.measure_o()
x0, y0, x1, y1 = m.OB
RX, RY = (x1 - x0) / 2, (y1 - y0) / 2

def poly(pts):
    p = pathops.Path(); pen = p.getPen(); pen.moveTo(pts[0])
    for q in pts[1:]: pen.lineTo(q)
    pen.closePath(); return p

def isect(p1, d1, p2, d2):
    den = d1[0]*d2[1] - d1[1]*d2[0]
    t = ((p2[0]-p1[0])*d2[1] - (p2[1]-p1[1])*d2[0]) / den
    return (p1[0]+d1[0]*t, p1[1]+d1[1]*t)

def check_poly(s, v, e, hw):
    d1 = m.norm((v[0]-s[0], v[1]-s[1])); d2 = m.norm((e[0]-v[0], e[1]-v[1]))
    n1 = (-d1[1], d1[0]); n2 = (-d2[1], d2[0]); out = []
    for k in (1, -1):
        a = (s[0]+n1[0]*hw*k, s[1]+n1[1]*hw*k); b = (v[0]+n2[0]*hw*k, v[1]+n2[1]*hw*k)
        out.append((a, isect(a, d1, b, d2), (e[0]+n2[0]*hw*k, e[1]+n2[1]*hw*k)))
    (a1, j1, e1), (a2, j2, e2) = out
    return [a1, j1, e1, e2, j2, a2]

def q(ox, T):
    cx, cy = ox + (x0 + x1) / 2, -(y0 + y1) / 2
    v = (cx + T["vx"] * RX, cy + T["vy"] * RY)
    a1, a2 = math.radians(T["a1"]), math.radians(T["a2"])
    s = (v[0] - T["L1"] * math.cos(a1), v[1] - T["L1"] * math.sin(a1))
    e = (v[0] + T["L2"] * math.cos(a2), v[1] - T["L2"] * math.sin(a2))
    hw = SIDE * T.get("k", 0.88) / 2
    bowl = pathops.Path(); m.gs[m.gn("O")].draw(TransformPen(bowl.getPen(), (1, 0, 0, -1, ox, 0)))
    bowl = pathops.op(bowl, poly(check_poly(s, v, e, hw * (1 + 2 * T["knock"]))), pathops.PathOp.DIFFERENCE)
    res = pathops.op(bowl, poly(check_poly(s, v, e, hw)), pathops.PathOp.UNION)
    pen = SVGPathPen(None); res.draw(pen)
    return pen.getCommands(), res.bounds

def word(T):
    left, wl = m.shape("Veri"); right, _ = m.shape("all")
    qd, qb = q(wl, T)
    xa = max(qb[2], wl + x1) + m.O_RSB * T.get("gap", 0.9)
    letters = "".join(m.gpath(g, x) for g, x in left) + "".join(m.gpath(g, xa + x) for g, x in right)
    box = m.union([m.gbox(g, x) for g, x in left] + [m.gbox(g, xa + x) for g, x in right] + [qb])
    return letters, qd, box

def put(inner, b, x, y, w, h):
    s = min(w / (b[2]-b[0]), h / (b[3]-b[1]))
    dx, dy = x + (w - (b[2]-b[0])*s)/2, y + (h - (b[3]-b[1])*s)/2
    return f'<g transform="translate({dx:.1f},{dy:.1f}) scale({s:.5f}) translate({-b[0]:.0f},{-b[1]:.0f})">{inner}</g>'

if __name__ == "__main__":
  pass
T = {
 "A tail-hake":   dict(vx=0.95, vy=1.13, a1=45, L1=700, a2=58, L2=900, knock=0.25),
 "B hake ut":     dict(vx=0.10, vy=0.55, a1=45, L1=330, a2=55, L2=1150, knock=0.25),
 "C kort hale":   dict(vx=0.86, vy=1.08, a1=45, L1=640, a2=60, L2=760, knock=0.22, k=0.84),
}
def render_sheet():
    rows = []; y = 20
    for name, t in T.items():
        L, Q, B = word(t); qd, qb = q(0, t)
        rows.append(f'<text x="30" y="{y+22}" font-family="Schibsted Grotesk" font-weight="700" font-size="20" fill="{C["ink"]}">{name}</text>')
        rows.append(f'<rect x="30" y="{y+35}" width="760" height="220" rx="16" fill="{C["paper"]}"/>')
        rows.append(put(f'<path fill="{C["ink"]}" d="{L}"/><path fill="{C["brand"]}" d="{Q}"/>', B, 70, y+70, 680, 150))
        rows.append(f'<rect x="810" y="{y+35}" width="360" height="220" rx="16" fill="{C["paper"]}"/>')
        rows.append(put(f'<path fill="{C["brand"]}" d="{qd}"/>', qb, 830, y+55, 180, 180))
        rows.append(put(f'<path fill="{C["brand"]}" d="{qd}"/>', qb, 1050, y+130, 32, 32))
        rows.append(put(f'<path fill="{C["brand"]}" d="{qd}"/>', qb, 1110, y+138, 16, 16))
        y += 280
    svg = f'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="{y}"><rect width="1200" height="{y}" fill="#E6E6EE"/>' + "".join(rows) + "</svg>"
    cairosvg.svg2png(bytestring=svg.encode(), write_to="tune.png", output_width=1200)
