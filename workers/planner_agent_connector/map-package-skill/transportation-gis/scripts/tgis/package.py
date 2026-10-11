"""Figures PDF, checksum manifest and the transfer ZIP."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

import fitz

ASSETS = Path(__file__).resolve().parents[2] / "assets"
FONT = ASSETS / "fonts" / "inter-ttf"


def figures_pdf(pkg_dir, package, log=print):
    """One PDF: cover, list of figures, then every figure at its own page size."""
    pkg = Path(pkg_dir)
    p = package["project"]
    out = pkg / "atlas" / f"{p['id']}_figures.pdf"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Posters stay out of the combined file: a 24 by 36 page among letter pages does not print sensibly.
    maps = [m for m in package["maps"] if (pkg / "maps" / "pdf" / f"{m['id']}.pdf").exists() and max(m["page"]["w"], m["page"]["h"]) <= 17.01]
    if not maps:
        return None
    doc = fitz.open()
    W, H = 612, 792
    accent = (package.get("brand") or {}).get("accent", "#1f5673")
    rgb = tuple(int(accent.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4))
    ink, gray = (0.12, 0.18, 0.21), (0.36, 0.41, 0.44)

    def fonts(page):
        page.insert_font(fontname="I", fontfile=str(FONT / "Inter-Regular.ttf"))
        page.insert_font(fontname="IS", fontfile=str(FONT / "Inter-SemiBold.ttf"))

    pg = doc.new_page(width=W, height=H)
    fonts(pg)
    pg.draw_rect(fitz.Rect(54, 54, W - 54, 60), color=None, fill=rgb)
    pg.insert_textbox(fitz.Rect(54, 84, W - 54, 110), (p.get("client") or "").upper(), fontname="IS", fontsize=9.5, color=rgb)
    pg.insert_textbox(fitz.Rect(54, 108, W - 54, 300), p["title"], fontname="IS", fontsize=30, color=ink, lineheight=1.12)
    status = (p.get("status") or "").strip()
    line = "Maps and figures. " + (status.capitalize() + ", " if status and status.lower() != "final" else "") + p["date_line"] + "."
    pg.insert_textbox(fitz.Rect(54, 300, W - 54, 330), line, fontname="I", fontsize=12, color=gray)
    if p.get("prepared_by"):
        pg.insert_textbox(fitz.Rect(54, H - 96, W - 54, H - 70), "Prepared by " + p["prepared_by"], fontname="I", fontsize=10, color=gray)
    pg.insert_textbox(fitz.Rect(54, H - 78, W - 54, H - 54), f"{package['crs']['name']} (EPSG:{package['crs']['epsg']}).", fontname="I", fontsize=8.5, color=gray)

    pg = doc.new_page(width=W, height=H)
    fonts(pg)
    pg.draw_rect(fitz.Rect(54, 54, W - 54, 57), color=None, fill=rgb)
    pg.insert_textbox(fitz.Rect(54, 74, W - 54, 110), "List of figures", fontname="IS", fontsize=18, color=ink)
    y = 124
    toc = []
    for i, m in enumerate(maps):
        label = (m.get("figure") or f"Map {i + 1}")
        pg.insert_textbox(fitz.Rect(54, y, 140, y + 16), label, fontname="IS", fontsize=10, color=ink)
        pg.insert_textbox(fitz.Rect(140, y, W - 100, y + 30), m["title"], fontname="I", fontsize=10, color=ink)
        pg.insert_textbox(fitz.Rect(W - 100, y, W - 54, y + 16), str(i + 3), fontname="I", fontsize=10, color=gray, align=fitz.TEXT_ALIGN_RIGHT)
        pg.draw_line((54, y + 20), (W - 54, y + 20), color=(0.84, 0.86, 0.87), width=0.5)
        toc.append([1, f"{label}. {m['title']}", i + 3])
        y += 28
    for m in maps:
        src = fitz.open(pkg / "maps" / "pdf" / f"{m['id']}.pdf")
        doc.insert_pdf(src)
    doc.set_toc(toc)
    doc.set_metadata({"title": f"{p['title']}: figures", "author": p.get("client", ""), "subject": "Maps and figures"})
    doc.save(out, deflate=True, garbage=3)
    log(f"  figures PDF: {out.name}: cover, list and {len(maps)} figures")
    return f"atlas/{out.name}"


def archive_sources(pkg_dir, project_dir, package, log=print):
    """Put everything a receiver needs to rebuild from the original downloads inside the package.

    source/   project.yaml, inputs/ (supplied files) and cache/ (every raw download this build read,
              with provenance.json: publisher, URL, query, retrieval date)
    tools/    a copy of this kit (scripts, assets, references)
    Rebuild with no network:  python3 tools/transportation-gis/scripts/tgis.py build source --offline
    """
    pkg, project_dir = Path(pkg_dir), Path(project_dir)
    src = pkg / "source"
    if src.exists():
        shutil.rmtree(src)
    (src / "cache").mkdir(parents=True)
    shutil.copy(project_dir / "project.yaml", src / "project.yaml")
    if (project_dir / "inputs").exists():
        shutil.copytree(project_dir / "inputs", src / "inputs")
    n = 0
    for name in package.get("cache_files", []):
        f = project_dir / "cache" / name
        if f.is_file():
            shutil.copy(f, src / "cache" / name)
            n += 1
    for extra in ("review.json",):
        if (project_dir / extra).exists():
            shutil.copy(project_dir / extra, src / extra)
    if (project_dir / "review_evidence").exists():
        shutil.copytree(project_dir / "review_evidence", src / "review_evidence")
    kit = ASSETS.parent
    tools = pkg / "tools" / "transportation-gis"
    if tools.exists():
        shutil.rmtree(tools)
    ignore = shutil.ignore_patterns("__pycache__", "*.pyc", "evals")
    for part in ("scripts", "assets", "references", "agents"):
        if (kit / part).exists():
            shutil.copytree(kit / part, tools / part, ignore=ignore)
    shutil.copy(kit / "SKILL.md", tools / "SKILL.md")
    size = sum(f.stat().st_size for f in src.rglob("*") if f.is_file()) / 1e6
    log(f"  source archive: {n} original downloads ({size:.1f} MB), project.yaml, inputs, and the kit under tools/")
    return {"cache_files": n, "mb": round(size, 1)}


def rebuild_check(pkg_dir, log=print):
    """Copy the package elsewhere, rebuild it from source/ with the network switched off, and compare every figure.

    This is the test that the package is self-sufficient: it uses only what is inside the copy.
    Writes qa/rebuild_check.json. Returns the result dict.
    """
    pkg = Path(pkg_dir)

    def hashes(root):
        files = sorted((root / "maps" / "png").glob("*.png")) + sorted((root / "atlas" / "sheets").glob("*.png"))
        return {f.relative_to(root).as_posix(): hashlib.sha256(f.read_bytes()).hexdigest() for f in files}

    before = hashes(pkg)
    with tempfile.TemporaryDirectory(prefix="tgis_rebuild_") as tmp:
        work = Path(tmp) / "relocated"
        shutil.copytree(pkg / "source", work / "source")
        shutil.copytree(pkg / "tools", work / "tools")
        env = dict(os.environ, TGIS_OFFLINE="1", QT_QPA_PLATFORM="offscreen")
        cmd = [sys.executable, str(work / "tools" / "transportation-gis" / "scripts" / "tgis.py"), "render", str(work / "source"), "--name", "rebuilt"]
        run = subprocess.run(cmd, capture_output=True, text=True, env=env, cwd=str(work))
        result = {"command": "TGIS_OFFLINE=1 python3 tools/transportation-gis/scripts/tgis.py render source --name rebuilt",
                  "exit_code": run.returncode, "network": "blocked by the kit (TGIS_OFFLINE); any download attempt fails the build",
                  "scope": "Same computer and software. Not evidence of cross-platform or cross-application equivalence."}
        if run.returncode != 0:
            result.update(status="FAILED", error=(run.stderr or run.stdout)[-800:])
        else:
            after = hashes(work / "source" / "build" / "rebuilt")
            same = [k for k in before if after.get(k) == before[k]]
            diff = [k for k in before if after.get(k) != before[k]]
            result.update(status="identical" if not diff else "DIFFERS", figures=len(before), identical=len(same), differing=diff)
    (pkg / "qa").mkdir(exist_ok=True)
    (pkg / "qa" / "rebuild_check.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    if result["status"] == "identical":
        log(f"  rebuild check: rebuilt offline from the archived sources in a separate folder; {result['identical']} of {result['figures']} PNGs are bit-identical")
    else:
        log(f"  rebuild check: {result['status']} ({result.get('differing') or result.get('error', '')[-300:]})")
    return result


def verify(pkg_dir):
    """Check an extracted package against its MANIFEST.sha256. Returns a list of problems (empty when it matches)."""
    pkg = Path(pkg_dir)
    mf = pkg / "MANIFEST.sha256"
    if not mf.is_file():
        return ["No MANIFEST.sha256 in " + str(pkg)]
    problems, listed = [], set()
    for line in mf.read_text(encoding="utf-8").splitlines():
        digest, rel = line.split("  ", 1)
        listed.add(rel)
        f = pkg / rel
        if not f.is_file():
            problems.append("Missing: " + rel)
        elif hashlib.sha256(f.read_bytes()).hexdigest() != digest:
            problems.append("Changed: " + rel)
    actual = {f.relative_to(pkg).as_posix() for f in pkg.rglob("*") if f.is_file() and f.name != "MANIFEST.sha256"
              and "arcgis/native" not in f.as_posix() and "__pycache__" not in f.parts}
    for extra in sorted(actual - listed)[:20]:
        problems.append("Not in the manifest: " + extra)
    return problems


def manifest(pkg_dir):
    pkg = Path(pkg_dir)
    lines = []
    for f in sorted(pkg.rglob("*")):
        if f.is_symlink():
            raise ValueError(f"A package must not contain symlinks: {f}")
        if f.is_file() and f.name != "MANIFEST.sha256" and "arcgis/native" not in f.as_posix() and "__pycache__" not in f.parts:
            lines.append(f"{hashlib.sha256(f.read_bytes()).hexdigest()}  {f.relative_to(pkg).as_posix()}")
    (pkg / "MANIFEST.sha256").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return len(lines)


def make_zip(pkg_dir, log=print):
    """Zip the package beside itself, then extract it to a scratch folder and verify every checksum."""
    pkg = Path(pkg_dir)
    n = manifest(pkg)
    zpath = pkg.parent / (pkg.name + ".zip")
    if zpath.exists():
        zpath.unlink()
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for f in sorted(pkg.rglob("*")):
            if f.is_file() and "arcgis/native" not in f.as_posix() and "__pycache__" not in f.parts:
                z.write(f, Path(pkg.name) / f.relative_to(pkg))
    with tempfile.TemporaryDirectory() as tmp:
        with zipfile.ZipFile(zpath) as z:
            z.extractall(tmp)
        root = Path(tmp) / pkg.name
        bad = 0
        for line in (root / "MANIFEST.sha256").read_text(encoding="utf-8").splitlines():
            digest, rel = line.split("  ", 1)
            f = root / rel
            if not f.exists() or hashlib.sha256(f.read_bytes()).hexdigest() != digest:
                bad += 1
    if bad:
        raise RuntimeError(f"ZIP verification failed: {bad} files differ from the manifest")
    zpath.with_suffix(".zip.sha256").write_text(hashlib.sha256(zpath.read_bytes()).hexdigest() + "  " + zpath.name + "\n", encoding="utf-8")
    size = zpath.stat().st_size / 1e6
    log(f"  ZIP: {zpath.name}, {size:.1f} MB, {n} files, extracted and verified against the manifest")
    return {"zip": str(zpath), "files": n, "mb": round(size, 1)}
