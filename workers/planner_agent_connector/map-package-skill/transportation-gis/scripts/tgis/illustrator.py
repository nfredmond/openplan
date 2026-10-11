"""Adobe Illustrator kit: script, swatches, layer names and notes."""
from __future__ import annotations

import json
import re
import shutil
import struct
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[2] / "assets"


def _symbols(package):
    """(name, hex) for every colour used by a thematic or base symbol, named for the swatch panel."""
    out, seen = [], set()

    def add(name, value):
        if value and isinstance(value, str) and value.startswith("#") and (name, value.lower()) not in seen:
            seen.add((name, value.lower()))
            out.append((name, value))

    def walk(title, r):
        items = [(r.get("label") or title, r["symbol"])] if r["type"] == "simple" else [(c["label"], c["symbol"]) for c in r["classes"]]
        for label, s in items:
            base = f"{title}: {label}" if label != title else title
            for key, suffix in (("color", ""), ("fill", ""), ("casing", " casing"), ("stroke", " outline")):
                add(base + suffix, s.get(key))

    for lid, info in package["data"].items():
        if "renderer" in info:
            walk(info["title"], info["renderer"])
    for m in package["maps"][:1]:
        for l in m["layers"]:
            if l["group"] == "base":
                walk("Base " + l["title"].lower(), l["renderer"])
    add("Text ink", "#1f2d35"); add("Text gray", "#5b6970"); add("Land", "#f5f4ef")
    add("Accent", (package.get("brand") or {}).get("accent", "#1f5673"))
    return out


def write_ase(path, colors, group="Map package"):
    """Adobe Swatch Exchange file (RGB process colours in one group)."""
    def name_bytes(s):
        enc = (s + "\0").encode("utf-16-be")
        return struct.pack(">H", len(s) + 1) + enc

    blocks = []
    gb = name_bytes(group)
    blocks.append(struct.pack(">HI", 0xC001, len(gb)) + gb)
    for name, hexv in colors:
        v = hexv.lstrip("#")
        rgb = [int(v[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
        body = name_bytes(name[:60]) + b"RGB " + struct.pack(">fff", *rgb) + struct.pack(">H", 2)
        blocks.append(struct.pack(">HI", 0x0001, len(body)) + body)
    blocks.append(struct.pack(">HI", 0xC002, 0))
    Path(path).write_bytes(b"ASEF" + struct.pack(">HHI", 1, 0, len(blocks)) + b"".join(blocks))


def tidy_svg(path):
    """Give every map layer group an id Illustrator can keep, and return {id: readable name}.

    QGIS labels its groups for Inkscape. Illustrator names objects from `id`, so each layer
    group gets a plain id and the readable name goes into layer_names.json for the script.
    """
    text = Path(path).read_text(encoding="utf-8")
    names = {}
    counter = [0]

    def fix(m):
        tag = m.group(0)
        lab = re.search(r'inkscape:label="([^"]*)"', tag)
        if not lab:
            return tag
        counter[0] += 1
        label = lab.group(1).replace("main_map: ", "Map: ").replace("inset_map: ", "Inset: ")
        new_id = "L%02d_%s" % (counter[0], re.sub(r"[^A-Za-z0-9]+", "_", label).strip("_"))
        names[new_id] = label
        if re.search(r'\sid="[^"]*"', tag):
            tag = re.sub(r'\sid="[^"]*"', f' id="{new_id}"', tag, count=1)
        else:
            tag = tag[:-1] + f' id="{new_id}">'
        return tag

    text = re.sub(r'<g\b[^>]*inkscape:groupmode="layer"[^>]*>', fix, text)
    Path(path).write_text(text, encoding="utf-8")
    return names


def build(pkg_dir, package, log=print):
    pkg = Path(pkg_dir)
    out = pkg / "illustrator"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copy(ASSETS / "illustrator" / "Open_Maps_In_Illustrator.jsx", out / "Open_Maps_In_Illustrator.jsx")
    names = {}
    for svg in sorted((pkg / "maps" / "svg").glob("*.svg")) + sorted((pkg / "atlas" / "svg").glob("*.svg")):
        names.update(tidy_svg(svg))
    (out / "layer_names.json").write_text(json.dumps(names, indent=1), encoding="utf-8")
    colors = _symbols(package)
    pid = package["project"]["id"]
    write_ase(out / f"{pid}_swatches.ase", colors)
    (out / f"{pid}_swatches.txt").write_text("\n".join(f"{h}\t{n}" for n, h in colors) + "\n", encoding="utf-8")
    log(f"  Illustrator kit: script, {len(colors)} swatches, {len(names)} named layers")
    return {"swatches": len(colors), "layers": len(names)}
