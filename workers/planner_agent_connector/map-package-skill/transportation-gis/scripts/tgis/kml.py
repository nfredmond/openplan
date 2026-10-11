"""Google Earth output: one KMZ with a folder per data layer, the figure symbols and attribute pop-ups."""
from __future__ import annotations

import html
import zipfile
from pathlib import Path

from . import svgsym, vec


def _kml_color(hex_color, opacity=1.0):
    """'#rrggbb' to KML aabbggrr."""
    if not hex_color:
        return "00ffffff"
    v = hex_color.lstrip("#")
    return f"{int(255 * opacity):02x}{v[4:6]}{v[2:4]}{v[0:2]}"


def _classes(r):
    """[(key, label, symbol, test)] for a renderer; test(props) says whether a feature belongs."""
    if r["type"] == "simple":
        return [("s", r["label"], r["symbol"], lambda p: True)]
    out = []
    f = r["field"]
    if r["type"] == "categorized":
        for i, c in enumerate(r["classes"]):
            vals = {str(v) for v in c["values"]}
            out.append((f"c{i}", c["label"], c["symbol"], lambda p, vals=vals: str(p.get(f)) in vals))
        if r.get("other"):
            out.append(("other", r["other"]["label"], r["other"]["symbol"], lambda p: True))
    else:
        for i, c in enumerate(r["classes"]):
            out.append((f"c{i}", c["label"], c["symbol"],
                        lambda p, c=c: isinstance(p.get(f), (int, float)) and (c["min"] is None or p[f] >= c["min"]) and (c["max"] is None or p[f] < c["max"])))
        if r.get("nodata"):
            out.append(("nodata", r["nodata"]["label"], r["nodata"]["symbol"], lambda p: p.get(f) is None))
    return out


def build(pkg_dir, package, log=print):
    pkg = Path(pkg_dir)
    out_dir = pkg / "google-earth"
    icon_dir = out_dir / "icons"
    icon_dir.mkdir(parents=True, exist_ok=True)
    epsg = package["crs"]["epsg"]
    ct = vec.transformer(epsg, 4326)
    proj = package["project"]
    parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2">', "<Document>",
             f"<name>{html.escape(proj['title'])}</name>",
             f"<description>{html.escape(proj.get('client', ''))}. {html.escape(proj['date_line'])}. Data layers from the map package.</description>"]
    folders, icons, n_total = [], [], 0
    order = {"polygon": 0, "line": 1, "point": 2}
    todo = [("study_area", {"file": "data/project.gpkg", "layer": "study_area", "kind": "polygon", "title": "Study area",
                            "renderer": {"type": "simple", "label": "Study area", "symbol": {"kind": "polygon", "fill": None, "stroke": "#2b3a42", "stroke_width": 1.6}}})]
    todo += sorted(((lid, info) for lid, info in package["data"].items() if "renderer" in info), key=lambda t: order[t[1]["kind"]])
    for lid, info in todo:
        feats, _, _ = vec.read(pkg / info["file"], info["layer"])
        classes = _classes(info["renderer"])
        for key, label, s, _ in classes:
            sid = f"{lid}_{key}"
            if s["kind"] == "line":
                parts.append(f'<Style id="{sid}"><LineStyle><color>{_kml_color(s["color"], s.get("opacity", 1.0))}</color><width>{max(1.5, s["width"] * 1.6):.1f}</width></LineStyle></Style>')
            elif s["kind"] == "polygon":
                edge = s.get("stroke") or (s.get("hatch") or {}).get("color") or s.get("fill")
                fill_op = (s.get("fill_opacity", 1.0) * 0.6) if s.get("fill") else 0.0
                parts.append(f'<Style id="{sid}"><LineStyle><color>{_kml_color(edge)}</color><width>{max(1.2, (s.get("stroke_width") or 0.6) * 1.6):.1f}</width></LineStyle>'
                             f'<PolyStyle><color>{_kml_color(s.get("fill") or "#ffffff", fill_op)}</color><fill>{1 if s.get("fill") else 0}</fill></PolyStyle></Style>')
            else:
                svgsym.marker_png(s, icon_dir / f"{sid}.png")
                icons.append(icon_dir / f"{sid}.png")
                scale = max(0.5, min(1.4, s.get("size", 5) / 7.0))
                parts.append(f'<Style id="{sid}"><IconStyle><scale>{scale:.2f}</scale><Icon><href>icons/{sid}.png</href></Icon><hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/></IconStyle>'
                             f'<LabelStyle><scale>0.8</scale></LabelStyle></Style>')
        body = [f"<Folder><name>{html.escape(info.get('title', lid))}</name>"]
        for g, p in feats:
            key = next((k for k, _, _, test in classes if test(p)), None)
            if key is None:
                continue
            g = g.Clone()
            g.Transform(ct)
            name = p.get("name") or p.get("NAME") or next((lab for k, lab, _, _ in classes if k == key), "")
            rows = "".join(f"<tr><th align='left'>{html.escape(str(k))}</th><td>{html.escape(str(round(v, 2) if isinstance(v, float) else v))}</td></tr>"
                           for k, v in p.items() if v is not None)
            body.append(f"<Placemark><name>{html.escape(str(name))}</name><styleUrl>#{lid}_{key}</styleUrl>"
                        f"<description><![CDATA[<table>{rows}</table>]]></description>{g.ExportToKML()}</Placemark>")
            n_total += 1
        body.append("</Folder>")
        folders.append("".join(body))
    parts += folders
    parts += ["</Document>", "</kml>"]
    kmz = out_dir / f"{proj['id']}.kmz"
    with zipfile.ZipFile(kmz, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("doc.kml", "\n".join(parts))
        for ic in icons:
            z.write(ic, f"icons/{ic.name}")
    for ic in icons:
        ic.unlink()
    icon_dir.rmdir()
    log(f"  Google Earth: {kmz.name} with {n_total} placemarks in {len(folders)} folders")
    return {"kmz": f"google-earth/{kmz.name}", "placemarks": n_total}
