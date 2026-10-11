"""Automated checks on a built package, and the review sheets a person or reviewer agent looks at.

Each check records pass or fail with the evidence. The checks cover what a script can know:
files, page sizes, fonts, text, data integrity, links and builder logic. They do not judge
whether a map looks right; that takes eyes on the PNGs (see references/review.md).
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
import re
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from pathlib import Path
from xml.etree import ElementTree as ET

import fitz
import numpy as np
from PIL import Image

from . import mock_arcpy

Image.MAX_IMAGE_PIXELS = None
EM_DASH = chr(0x2014)


class Report:
    def __init__(self):
        self.items = []

    def add(self, group, name, ok, evidence="", level="fail"):
        """level 'note' marks something a person must decide (licence terms, a data caveat); it is listed but is not a failure."""
        self.items.append({"group": group, "check": name, "passed": bool(ok), "evidence": str(evidence), "level": level})

    @property
    def failed(self):
        return [i for i in self.items if not i["passed"] and i["level"] == "fail"]

    @property
    def notes(self):
        return [i for i in self.items if not i["passed"] and i["level"] == "note"]


def _png_frame_std(png, m, dpi):
    im = Image.open(png).convert("L")
    f = m["frame"]
    sx = im.width / m["page"]["w"]
    box = [int(f["x"] * sx), int(f["y"] * sx), int((f["x"] + f["w"]) * sx), int((f["y"] + f["h"]) * sx)]
    a = np.asarray(im.crop(box).resize((300, 300)), dtype=float)
    return float(a.std())


def _cvd(im, kind):
    """Simulate grayscale printing or deuteranopia (Machado et al. 2009, severity 1.0)."""
    a = np.asarray(im.convert("RGB"), dtype=float) / 255.0
    if kind == "gray":
        g = a @ np.array([0.2126, 0.7152, 0.0722])
        out = np.stack([g, g, g], axis=-1)
    else:
        lin = np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)
        M = np.array([[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]])
        lin = np.clip(lin @ M.T, 0, 1)
        out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype("uint8"))


def contact_sheet(images, path, cols=3, cell=900, label=None):
    if not images:
        return
    thumbs = []
    for p in images:
        im = Image.open(p).convert("RGB")
        im.thumbnail((cell, cell), Image.LANCZOS)
        thumbs.append(im)
    rows = (len(thumbs) + cols - 1) // cols
    pad = 24
    sheet = Image.new("RGB", (cols * (cell + pad) + pad, rows * (cell + pad) + pad), "#7d878c")
    for i, im in enumerate(thumbs):
        x = pad + (i % cols) * (cell + pad) + (cell - im.width) // 2
        y = pad + (i // cols) * (cell + pad) + (cell - im.height) // 2
        sheet.paste(im, (x, y))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "JPEG", quality=88)


def run(pkg_dir, log=print):
    pkg = Path(pkg_dir)
    package = json.loads((pkg / "spec" / "map_package.json").read_text(encoding="utf-8"))
    R = Report()
    qa_dir = pkg / "qa"
    qa_dir.mkdir(exist_ok=True)
    font = package["font"]["family"]
    pid = package["project"]["id"]
    outs = package.get("outputs", [])

    # ---- spec-level warnings carried from the build
    for w in package.get("warnings", []):
        R.add("spec", "build warning", False, w, level="note")

    # ---- figures
    pngs = []
    for m in package["maps"]:
        mid = m["id"]
        pdf, png, svg = pkg / "maps" / "pdf" / f"{mid}.pdf", pkg / "maps" / "png" / f"{mid}.png", pkg / "maps" / "svg" / f"{mid}.svg"
        for f in (pdf, png, svg):
            R.add("figures", f"{mid}: {f.suffix[1:]} exists", f.exists() and f.stat().st_size > 2000, f.relative_to(pkg))
        if pdf.exists():
            doc = fitz.open(pdf)
            pg = doc[0]
            w, h = pg.rect.width / 72, pg.rect.height / 72
            R.add("figures", f"{mid}: PDF page is {m['page']['w']:g} by {m['page']['h']:g} in", abs(w - m["page"]["w"]) < 0.02 and abs(h - m["page"]["h"]) < 0.02, f"{w:.2f} by {h:.2f} in")
            fonts = {f[3].split("+")[-1] for f in pg.get_fonts()}
            R.add("figures", f"{mid}: PDF text is live and set in {font}", bool(fonts) and all(font.lower() in f.lower() for f in fonts), sorted(fonts))
            text = pg.get_text()
            title_words = [w_ for w_ in re.findall(r"\w+", m["title"]) if len(w_) > 3]
            if m["template"] != "figure":
                R.add("figures", f"{mid}: title text is on the page", all(w_ in text for w_ in title_words), m["title"])
            R.add("figures", f"{mid}: no em dash in map text", EM_DASH not in text, "")
            sizes = [s["size"] for b in pg.get_text("dict")["blocks"] for l in b.get("lines", []) for s in l["spans"] if s["text"].strip()]
            # Wall posters are read from a distance, so their floor rises with the page.
            floor = 5.45 if min(m["page"]["w"], m["page"]["h"]) < 18 else 14.0
            R.add("figures", f"{mid}: smallest type is {floor + 0.05:.1f} pt or larger", bool(sizes) and min(sizes) >= floor, f"min {min(sizes):.1f} pt" if sizes else "no text")
            R.add("figures", f"{mid}: no text was cut to fit", not m.get("truncated"), ", ".join(m.get("truncated", [])) or "")
            drawings = len(pg.get_drawings())
            R.add("figures", f"{mid}: PDF is vector (has drawn paths)", drawings > 50, f"{drawings} paths")
        if png.exists():
            im = Image.open(png)
            dpi = im.width / m["page"]["w"]
            R.add("figures", f"{mid}: PNG is 150 dpi or more and matches the page shape", dpi >= 149 and abs(im.height / dpi - m["page"]["h"]) < 0.03, f"{im.width} x {im.height} px, {dpi:.0f} dpi")
            std = _png_frame_std(png, m, dpi)
            R.add("figures", f"{mid}: map frame is not blank", std > 4.0, f"pixel standard deviation {std:.1f}")
            pngs.append(png)
        if svg.exists():
            try:
                root = ET.parse(svg).getroot()
                texts = sum(1 for e in root.iter() if e.tag.endswith("}text"))
                layers = sum(1 for e in root.iter() if e.attrib.get("{http://www.inkscape.org/namespaces/inkscape}groupmode") == "layer")
                R.add("figures", f"{mid}: SVG has live text and named layers", texts > 5 and layers > 5, f"{texts} text elements, {layers} layers")
            except ET.ParseError as e:
                R.add("figures", f"{mid}: SVG parses", False, e)
        lg = m["legend"]
        R.add("figures", f"{mid}: legend fits its space", lg["h"] <= lg["available"] + 0.05, f"needs {lg['h']:.2f} in, has {lg['available']:.2f} in")
        R.add("figures", f"{mid}: alt text written", bool(m.get("alt")) and not m["alt"].lstrip().startswith("["), m.get("alt") or "missing: add `alt:` to the map in project.yaml")

    for a in package.get("atlases", []):
        pdf = pkg / "atlas" / f"{a['id']}.pdf"
        ok = pdf.exists()
        n = len(fitz.open(pdf)) if ok else 0
        R.add("map books", f"{a['id']}: PDF has {len(a['atlas']['pages'])} sheets", ok and n == len(a["atlas"]["pages"]), f"{n} pages")
        if ok:
            t = "".join(fitz.open(pdf)[0].get_text().split())      # letter-spaced type extracts with a space between letters
            hit = re.search(r"sheet1of%d" % n, t, re.I)
            R.add("map books", f"{a['id']}: sheet numbering resolved", "{" not in t and bool(hit), hit.group(0) if hit else "no 'Sheet 1 of %d' on the first sheet" % n)
            pngs += sorted((pkg / "atlas" / "sheets").glob(f"{a['id']}_*.png"))[:12]
        lg = a["legend"]
        R.add("map books", f"{a['id']}: legend fits its space", lg["h"] <= lg["available"] + 0.05, f"needs {lg['h']:.2f} in, has {lg['available']:.2f} in")
        R.add("map books", f"{a['id']}: no text was cut to fit", not a.get("truncated"), ", ".join(a.get("truncated", [])) or "")

    # ---- data
    for lid, info in package["data"].items():
        path = pkg / info["file"]
        try:
            with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True)) as con:
                row = con.execute("SELECT srs_id, geometry_type_name FROM gpkg_geometry_columns WHERE table_name=?", (info["layer"],)).fetchone()
                n = con.execute('SELECT COUNT(*) FROM "%s"' % info["layer"]).fetchone()[0]
            ok = row is not None and row[0] == package["crs"]["epsg"] and row[1].upper() not in ("GEOMETRY", "GEOMETRYCOLLECTION")
            R.add("data", f"{lid}: in EPSG:{package['crs']['epsg']} with a concrete geometry type", ok, f"srs {row[0] if row else None}, {row[1] if row else None}, {n} features")
            if "renderer" in info:
                R.add("data", f"{lid}: has features", n > 0, f"{n} features")
        except sqlite3.Error as e:
            R.add("data", f"{lid}: readable", False, e)

    # ---- QGIS project
    qgz = pkg / "qgis" / f"{pid}.qgz"
    if "qgis" in outs:
        ok = qgz.exists() and zipfile.is_zipfile(qgz)
        R.add("qgis", "project file exists", ok, qgz.name)
        if ok:
            with zipfile.ZipFile(qgz) as z:
                xml = z.read([n for n in z.namelist() if n.endswith(".qgs")][0]).decode("utf-8", "replace")
            n_lay = len(re.findall(r"<Layout\b", xml))
            R.add("qgis", "one layout per figure and map book", n_lay == len(package["maps"]) + len(package.get("atlases", [])), f"{n_lay} layouts")
            absolute = re.findall(r'source="(/[^"]*\.gpkg[^"]*)"', xml)
            R.add("qgis", "layer paths are relative to the package", not absolute, absolute[:2])

    # ---- ArcGIS Pro builder
    if "arcgis" in outs:
        bpath = pkg / "arcgis" / "build_arcgis_pro.py"
        if bpath.exists():
            spec = importlib.util.spec_from_file_location("tgis_native_builder_qa", bpath)
            b = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(b)
            pre = b.preflight(pkg)
            R.add("arcgis", "preflight: every layer, field and filter in the spec exists in the data", not pre["errors"], pre["errors"][:3] or f"{pre['input_layers']} input layers")
            # Failure probe: a spec that names a field the data lacks must be caught, or the check proves nothing.
            bad = copy.deepcopy(package)
            probe = next((l for m in bad["maps"] for l in m["layers"] if l["renderer"].get("field")), None)
            if probe:
                probe["renderer"]["field"] = "no_such_field_probe"
                R.add("arcgis", "preflight catches a deliberately broken spec", bool(b.preflight(pkg, bad)["errors"]), "probe: renamed a style field")
            try:
                mock_arcpy.install()
                out = tempfile.mkdtemp(prefix="tgis_dryrun_")
                b.build(pkg, template="CURRENT", output=out)
                rep = json.loads(next(Path(out).glob("*/native_build_report.json")).read_text())
                want = len(package["maps"]) + len(package.get("atlases", []))
                R.add("arcgis", "builder dry run (logic only, stand-in for ArcPy) reaches every layout", len(rep["layouts"]) == want and not rep["warnings"],
                      f"{len(rep['layouts'])} of {want} layouts, {len(rep['warnings'])} warnings")
            except Exception as e:  # noqa: BLE001
                R.add("arcgis", "builder dry run (logic only, stand-in for ArcPy) reaches every layout", False, repr(e)[:300])
            finally:
                import sys
                sys.modules.pop("arcpy", None)
        else:
            R.add("arcgis", "builder present", False, "arcgis/build_arcgis_pro.py missing")
        R.add("arcgis", "agent instructions present", (pkg / "arcgis" / "AGENT_PROMPT.md").exists(), "arcgis/AGENT_PROMPT.md")

    # ---- web, KMZ, Illustrator
    idx = pkg / "index.html"
    if "web" in outs:
        R.add("web", "index.html exists", idx.exists(), "")
        if idx.exists():
            h = idx.read_text(encoding="utf-8")
            refs = set(re.findall(r'(?:href|src)="([^"#]+)"', h))
            missing = [r for r in refs if not r.startswith(("http", "../", "mailto:", "qa/", "MANIFEST")) and not (pkg / r).exists()]
            R.add("web", "every link and asset in index.html resolves", not missing, missing[:5] or f"{len(refs)} references")
            R.add("web", "every figure image has alt text", 'alt=""' not in h, "")
    kmz = pkg / "google-earth" / f"{pid}.kmz"
    if "kmz" in outs:
        ok = kmz.exists() and zipfile.is_zipfile(kmz)
        n = 0
        if ok:
            with zipfile.ZipFile(kmz) as z:
                try:
                    root = ET.fromstring(z.read("doc.kml"))
                    n = sum(1 for e in root.iter() if e.tag.endswith("}Placemark"))
                except ET.ParseError:
                    ok = False
        R.add("google earth", "KMZ parses and holds placemarks", ok and n > 0, f"{n} placemarks")
    if "illustrator" in outs:
        R.add("illustrator", "script and swatches present", (pkg / "illustrator" / "Open_Maps_In_Illustrator.jsx").exists() and (pkg / "illustrator" / f"{pid}_swatches.ase").exists(), "")

    # ---- source archive and rebuild
    src = pkg / "source"
    if src.exists():
        missing = [n for n in package.get("cache_files", []) if not (src / "cache" / n).is_file() and n != "provenance.json"]
        R.add("sources", "every original download this build read is archived in source/cache", not missing and (src / "project.yaml").is_file(), missing[:4] or f"{len(package.get('cache_files', []))} files")
        R.add("sources", "the kit is in the package (tools/)", (pkg / "tools" / "transportation-gis" / "scripts" / "tgis.py").is_file(), "")
        rc = pkg / "qa" / "rebuild_check.json"
        if rc.exists():
            r_ = json.loads(rc.read_text())
            R.add("sources", "offline rebuild from the archived sources reproduces every figure bit for bit", r_.get("status") == "identical",
                  f"{r_.get('identical', 0)} of {r_.get('figures', 0)} identical" if r_.get("status") != "FAILED" else r_.get("error", "")[-200:])
        else:
            R.add("sources", "offline rebuild check was run", False, "skipped (--no-rebuild-check)", level="note")
    for m in package["maps"]:
        if "svg" in outs:
            o = pkg / "maps" / "svg_outlined" / f"{m['id']}.svg"
            ok = o.exists()
            if ok:
                ok = b"<text" not in o.read_bytes()
            R.add("figures", f"{m['id']}: outlined SVG exists and holds no live text", ok, "")

    # ---- prose
    bad = []
    for f in list(pkg.glob("*.md")) + list(pkg.glob("*/*.md")) + [idx]:
        if f.exists() and EM_DASH in f.read_text(encoding="utf-8", errors="replace"):
            bad.append(str(f.relative_to(pkg)))
    R.add("documents", "no em dash in any document", not bad, bad)
    for f in ("README.md", "AGENTS.md", "docs/figure_notes.md", "docs/data_sources.md", "docs/data_dictionary.md"):
        R.add("documents", f"{f} exists", (pkg / f).exists(), "")
    notes = (pkg / "docs" / "data_sources.md").read_text(encoding="utf-8") if (pkg / "docs" / "data_sources.md").exists() else ""
    n_verify = notes.count("[VERIFY TERMS]")
    R.add("documents", "licence or terms recorded for every source", n_verify == 0, f"{n_verify} sources marked [VERIFY TERMS] in docs/data_sources.md", level="note")
    # The package goes to other people. It should not carry this computer's folder names.
    home = str(Path.home())
    leaks = []
    for f in pkg.rglob("*"):
        if f.is_file() and f.suffix.lower() in (".md", ".json", ".html", ".js", ".qml", ".qpt", ".yaml", ".txt", ".svg", ".py", ".pyt", ".jsx") and "arcgis/native" not in f.as_posix():
            if home in f.read_text(encoding="utf-8", errors="replace"):
                leaks.append(str(f.relative_to(pkg)))
    R.add("documents", "no file carries this computer's home folder path", not leaks, leaks[:5])

    # ---- review sheets
    contact_sheet(pngs, qa_dir / "contact_sheet.jpg")
    tmp = Path(tempfile.mkdtemp())
    for kind in ("gray", "deuteranopia"):
        outs_ = []
        for p in pngs:
            im = Image.open(p)
            im.thumbnail((1400, 1400))
            q = tmp / f"{kind}_{p.stem}.png"
            _cvd(im, kind).save(q)
            outs_.append(q)
        contact_sheet(outs_, qa_dir / f"contact_sheet_{kind}.jpg")

    failed, notes = R.failed, R.notes
    summary = {"checks": len(R.items) - len(notes), "passed": len(R.items) - len(failed) - len(notes), "failed": len(failed), "notes": len(notes), "items": R.items,
               "not_checked": ["Native ArcGIS Pro build (no ArcGIS Pro on this computer)", "Illustrator script run in Illustrator",
                               "Printed proof", "Visual quality of each figure (see the review step)", "Client or agency acceptance"]}
    (qa_dir / "qa_report.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    L = [f"# Quality checks: {package['project']['title']}", "", f"{summary['passed']} of {summary['checks']} automated checks passed.", ""]
    if failed:
        L += ["## Failed", ""] + [f"- **{i['group']}**: {i['check']}. Evidence: {i['evidence']}" for i in failed] + [""]
    if notes:
        L += ["## Needs a decision", ""] + [f"- **{i['group']}**: {i['evidence']}" for i in notes] + [""]
    L += ["## Not checked by the scripts", ""] + [f"- {s}" for s in summary["not_checked"]] + ["", "## All checks", "", "| Group | Check | Result | Evidence |", "|---|---|---|---|"]
    L += [f"| {i['group']} | {i['check']} | {'pass' if i['passed'] else ('note' if i['level'] == 'note' else 'FAIL')} | {str(i['evidence'])[:140].replace('|', '/')} |" for i in R.items]
    L += ["", "Review sheets: `qa/contact_sheet.jpg`, `qa/contact_sheet_gray.jpg`, `qa/contact_sheet_deuteranopia.jpg`.", ""]
    (qa_dir / "qa_report.md").write_text("\n".join(L), encoding="utf-8")
    for i in failed:
        log(f"  FAIL {i['group']}: {i['check']} ({i['evidence']})")
    for i in notes:
        log(f"  NOTE {i['group']}: {i['evidence']}")
    log(f"  QA: {summary['passed']} of {summary['checks']} checks passed")

    def res(group, name):
        it = next((i for i in R.items if i["group"] == group and i["check"].startswith(name)), None)
        return "not run" if it is None else ("passed" if it["passed"] else "FAILED (" + it["evidence"][:120] + ")")
    summary["arcgis_preflight"] = res("arcgis", "preflight: every")
    summary["arcgis_dryrun"] = res("arcgis", "builder dry run") + ". This exercises the script's Python, not ArcGIS Pro"
    summary["verification"] = "\n".join([
        f"- Automated checks: {summary['passed']} of {summary['checks']} passed (`qa/qa_report.md`)." + (" Failures are listed there." if failed else ""),
        *[f"- Needs a decision: {i['evidence']}" for i in notes],
        "- QGIS project: built and exported on the computer that made this package. The figures are its output.",
        f"- ArcGIS Pro builder: preflight {summary['arcgis_preflight']}; dry run {res('arcgis', 'builder dry run')}. **The native ArcGIS Pro build has not been performed.** Follow `arcgis/AGENT_PROMPT.md` on a computer with ArcGIS Pro.",
        "- Adobe Illustrator script: written, not run in Illustrator.",
        "- Offline rebuild from the archived sources: " + res("sources", "offline rebuild from") + " (same computer; see `qa/rebuild_check.json`).",
        "- Review gates: see the table below. " + (package["project"].get("review") or ""),
        "- Not checked: printed proof, accessibility conformance of the PDFs, client or agency acceptance.",
    ])
    return summary
