"""Written parts of the package: README, agent instructions, figure notes, sources, data dictionary, design sheet."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

from . import vec

ASSETS = Path(__file__).resolve().parents[2] / "assets"
TPL = ASSETS / "templates" / "package"


def _thematic_titles(m):
    return [l["title"] for l in reversed(m["layers"]) if l["group"] == "thematic"]


def _credits(package):
    seen, out = set(), []
    for name, pr in package.get("provenance", {}).items():
        c = pr.get("credit") or pr.get("publisher")
        if c and c not in seen:
            seen.add(c)
            lic = f" ({pr['license']})" if pr.get("license") else ""
            out.append(f"{c}{lic}")
    return out


def figure_notes(package):
    L = [f"# Figure notes: {package['project']['title']}", "",
         "One entry per figure: what it shows, alt text for accessible documents, layers, sources, scale and limits.", ""]
    for m in package["maps"] + package.get("atlases", []):
        head = (m.get("figure") + ". " if m.get("figure") and "atlas" not in m else "") + m["title"]
        L += [f"## {head}", "", f"- **Files:** `maps/pdf/{m['id']}.pdf`, `maps/png/{m['id']}.png`, `maps/svg/{m['id']}.svg`" if "atlas" not in m
              else f"- **File:** `atlas/{m['id']}.pdf` ({len(m['atlas']['pages'])} sheets)",
              f"- **Page:** {m['page']['w']:g} by {m['page']['h']:g} in. **Scale:** {m['scale_text']} (1:{m['scale']:,.0f}).",
              f"- **Alt text:** {m.get('alt') or '[ALT TEXT NEEDED: one sentence that says what the map shows and its main finding]'}"]
        th = [l for l in reversed(m["layers"]) if l["group"] == "thematic"]
        if th:
            L.append("- **Data layers:**")
            for l in th:
                r = l["renderer"]
                n = package["data"][l["id"]]["count"]
                if r["type"] == "simple":
                    L.append(f"  - {l['title']}: {n} feature{'' if n == 1 else 's'}.")
                else:
                    parts = "; ".join(c["label"] if c["label"].rstrip().endswith(")") and str(c.get("count")) in c["label"][-12:] else f"{c['label']} ({c.get('count', 0)})" for c in r["classes"])
                    for extra in ("other", "nodata"):
                        if r.get(extra):
                            parts += f"; {r[extra]['label']} ({r[extra].get('count', 0)})"
                    L.append(f"  - {l['title']}, by `{r['field']}`: {parts}.")
        if m.get("sources"):
            L.append(f"- **{m['sources']}**")
        if m.get("notes"):
            L.append(f"- **Note on the map:** {m['notes']}")
        cav = [f"{package['data'][l['id']]['title']}: {pr['caveat']}" for l in th for pr in [package.get("provenance", {}).get(l["id"], {})] if pr.get("caveat")]
        for c in cav:
            L.append(f"- **Limit:** {c}")
        L.append("")
    return "\n".join(L)


def data_sources(package):
    L = [f"# Data sources: {package['project']['title']}", "",
         "Every download made for this package, with its query and retrieval date. Check the terms of each source before publishing.", "",
         "| Item | Publisher | Dataset or service | Retrieved | Licence or terms | URL |", "|---|---|---|---|---|---|"]
    for name, pr in package.get("provenance", {}).items():
        ds = pr.get("dataset") or pr.get("service_name") or pr.get("access") or ""
        cell = lambda v: " ".join(str(v or "").split()).replace("|", "/")
        L.append(f"| `{name}` | {cell(pr.get('publisher'))} | {cell(ds)} | {pr.get('retrieved', '')} | {cell(pr.get('license')) or '[VERIFY TERMS]'} | {pr.get('url', '')} |")
    L += ["", "## Queries", ""]
    for name, pr in package.get("provenance", {}).items():
        if pr.get("query"):
            q = pr["query"] if isinstance(pr["query"], str) else json.dumps(pr["query"])
            L.append(f"- `{name}`: `{q[:600]}`")
    return "\n".join(L) + "\n"


def data_dictionary(package, pkg):
    L = [f"# Data dictionary: {package['project']['title']}", "",
         f"All layers are in {package['crs']['name']} (EPSG:{package['crs']['epsg']}), units {package['crs']['unit']}.", ""]
    for lid, info in package["data"].items():
        li = vec.layer_info(pkg / info["file"], info["layer"])
        L += [f"## {info.get('title', lid)}", "", f"- **Layer:** `{info['file']}`, table `{info['layer']}`", f"- **Geometry:** {li['geometry_type']}, {li['count']} features"]
        if info.get("description"):
            L.append(f"- **Description:** {info['description']}")
        if info.get("clip") == "study_area":
            L.append("- **Extent:** clipped to the study area. This is not the publisher's full layer.")
        elif info.get("clip") == "bbox" and "renderer" in info:
            L.append("- **Extent:** only features near the study area were downloaded. This is not the publisher's full layer.")
        if info.get("filter"):
            L.append(f"- **Filter applied:** `{info['filter']}`")
        if info.get("renderer", {}).get("field"):
            L.append(f"- **Mapped by:** `{info['renderer']['field']}`")
        if li["fields"]:
            L += ["", "| Field | Type |", "|---|---|"] + [f"| `{k}` | {v} |" for k, v in li["fields"].items()]
        L.append("")
    return "\n".join(L)


def design_sheet(package):
    L = [f"# Design sheet: {package['project']['title']}", "",
         f"Type: {package['font']['family']} (SIL Open Font License). Sizes are points at final page size; larger pages scale type and symbols by the factor shown.", "",
         "## Pages", "", "| Figure | Template | Page (in) | Map frame (in, from top-left) | Type scale |", "|---|---|---|---|---|"]
    for m in package["maps"] + package.get("atlases", []):
        f = m["frame"]
        L.append(f"| `{m['id']}` | {m['template']} | {m['page']['w']:g} x {m['page']['h']:g} | x {f['x']:.2f}, y {f['y']:.2f}, {f['w']:.2f} x {f['h']:.2f} | {m['k']:g} |")
    L += ["", "## Page type", "", "| Element | Size | Weight | Colour |", "|---|---|---|---|"]
    seen = set()
    for m in package["maps"]:
        if m["k"] != 1.0:
            continue
        for el in m["elements"]:
            if el["type"] == "text" and el["id"] not in seen:
                seen.add(el["id"])
                L.append(f"| {el['id'].replace('_', ' ')} | {el['size']:g} pt | {el.get('weight', 'regular')} | `{el.get('color', '#1f2d35')}` |")
    L += ["| legend label | 7.8 pt | regular | `#1f2d35` |", "| legend group title | 8 pt | semibold | `#1f2d35` |", "",
          "## Data layer symbols", "", "| Layer | Class | Symbol |", "|---|---|---|"]

    def desc(s):
        if s["kind"] == "line":
            d = f"line `{s['color']}` {s['width']:g} pt"
            if s.get("dash"):
                d += f", dash {s['dash']}"
            if s.get("casing"):
                d += f", casing `{s['casing']}` {s['casing_width']:g} pt"
            return d
        if s["kind"] == "polygon":
            d = f"fill `{s.get('fill')}`" + (f" at {s.get('fill_opacity', 1) * 100:.0f}%" if s.get("fill") else "")
            if s.get("stroke"):
                d += f", outline `{s['stroke']}` {s.get('stroke_width', 0):g} pt"
            if s.get("hatch"):
                d += f", hatch {s['hatch'].get('angle', 45)} degrees"
            return d
        return f"{s.get('marker')} {s.get('size'):g} pt, fill `{s.get('fill')}`, outline `{s.get('stroke')}` {s.get('stroke_width') or 0:g} pt"

    for lid, info in package["data"].items():
        r = info.get("renderer")
        if not r:
            continue
        if r["type"] == "simple":
            L.append(f"| {info['title']} | {r['label']} | {desc(r['symbol'])} |")
        else:
            for c in r["classes"]:
                L.append(f"| {info['title']} | {c['label']} | {desc(c['symbol'])} |")
    L += ["", "## Base map", "", "Land `#f5f4ef`, water `#cddde6`, parks `#dde8d0`. Roads are white or pale yellow fills over gray or ochre casings, "
          "drawn casings first so junctions merge; widths step with scale (regional above 1:90,000, vicinity to 1:22,000, corridor below). "
          "Street names 6.2 to 7.4 pt along the street with a white halo; route numbers in rounded boxes; water names italic blue.", ""]
    return "\n".join(L)


def build(pkg_dir, package, qa=None, log=print):
    pkg = Path(pkg_dir)
    env = Environment(loader=FileSystemLoader(str(TPL)), keep_trailing_newline=True, trim_blocks=False)
    maps = [dict(m, thematic_titles=_thematic_titles(m)) for m in package["maps"]]
    atlases = [dict(a, thematic_titles=_thematic_titles(a)) for a in package.get("atlases", [])]
    status = (package["project"].get("status") or "").strip()
    qrep = {}
    qp = pkg / "qgis" / "qgis_build_report.json"
    if qp.exists():
        qrep = json.loads(qp.read_text())
    qa = qa or {}
    proj = package["project"]
    notice = proj.get("notice") or ("Practice package. Some content is hypothetical or unverified; see docs/figure_notes.md. Not for decisions, applications or publication." if proj.get("practice") else "")
    ctx = dict(notice=notice, review=qa.get("review") or {"gates": [], "blockers": [], "release_ready": False}, p=package["project"], crs=package["crs"], maps=maps, atlases=atlases, font=package["font"]["family"],
               status=status if status.lower() != "final" else "", dpi=300, credits=_credits(package),
               qgis_version=qrep.get("qgis_version", "[NOT BUILT]"),
               preflight=qa.get("arcgis_preflight", "not run"), dryrun=qa.get("arcgis_dryrun", "not run"),
               n_swatches=qa.get("n_swatches", "all"),
               verification=qa.get("verification", "- Run `tgis.py qa` to fill in this section."))
    for src, dst in (("README.md.j2", "README.md"), ("AGENTS.md.j2", "AGENTS.md"), ("arcgis_AGENT_PROMPT.md.j2", "arcgis/AGENT_PROMPT.md"),
                     ("arcgis_README.md.j2", "arcgis/README.md"), ("qgis_AGENT_PROMPT.md.j2", "qgis/AGENT_PROMPT.md"),
                     ("qgis_README.md.j2", "qgis/README.md"), ("illustrator_README.md.j2", "illustrator/README.md")):
        out = pkg / dst
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(env.get_template(src).render(**ctx), encoding="utf-8")
    (pkg / "docs").mkdir(exist_ok=True)
    (pkg / "docs" / "figure_notes.md").write_text(figure_notes(package), encoding="utf-8")
    (pkg / "docs" / "data_sources.md").write_text(data_sources(package), encoding="utf-8")
    (pkg / "docs" / "data_dictionary.md").write_text(data_dictionary(package, pkg), encoding="utf-8")
    (pkg / "docs" / "design_sheet.md").write_text(design_sheet(package), encoding="utf-8")
    # Builders and fonts travel with the package so it can be rebuilt on a computer that has no copy of the skill.
    shutil.copy(ASSETS / "arcgis" / "build_arcgis_pro.py", pkg / "arcgis" / "build_arcgis_pro.py")
    shutil.copy(ASSETS / "arcgis" / "Build_Maps.pyt", pkg / "arcgis" / "Build_Maps.pyt")
    shutil.copy(Path(__file__).with_name("qgis_builder.py"), pkg / "qgis" / "build_qgis_project.py")
    shutil.copy(ASSETS / "qgis" / "Rebuild_Maps_Processing.py", pkg / "qgis" / "Rebuild_Maps_Processing.py")
    shutil.copytree(ASSETS / "fonts" / "inter", pkg / "fonts" / "inter", dirs_exist_ok=True)
    log("  documents: README, AGENTS, agent prompts, figure notes, sources, data dictionary, design sheet")
