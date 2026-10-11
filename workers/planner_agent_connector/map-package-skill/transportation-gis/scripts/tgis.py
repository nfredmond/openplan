#!/usr/bin/env python3
"""Transportation GIS map package builder.

  tgis.py init <project folder> [--place "City, ST"]   start a project (writes project.yaml)
  tgis.py build <project folder>                        build the whole package
  tgis.py render <project folder> [--only id ...]       data, QGIS project and figures only (fast loop while designing)
  tgis.py qa <package folder>                           rerun the automated checks
  tgis.py attest <project folder> <gate> --reviewer .. --note .. --evidence file   record a review gate
  tgis.py verify <package folder>                       check an extracted package against its manifest
  tgis.py rebuild-check <package folder>                rebuild offline from the package's own sources and compare
  tgis.py presets                                       list the style presets
  tgis.py doctor                                        check that this computer can build
  tgis.py inspect <file or ArcGIS layer URL> [--place "City, ST"]   fields and class values of a source
  tgis.py corridor <project folder> --street "Main Street" --place "City, ST"   one line along a street

Needs QGIS 3.34 or later with its Python bindings (python3-qgis), GDAL, PyMuPDF, Pillow, PyYAML, Jinja2, requests.
"""
import argparse
import datetime
import json
import shutil
import sys
import time
from pathlib import Path

import os
os.environ.setdefault("QT_HASH_SEED", "0")      # repeatable label placement; see qgis_builder.py
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.dont_write_bytecode = True      # keep the skill folder and the delivered package free of __pycache__


def log(msg=""):
    print(msg, flush=True)


def pkg_dir(project_dir, spec, name=None):
    pid = (spec["project"].get("id") or "project").lower()
    stamp = datetime.date.today().strftime("%Y%m%d")
    return Path(project_dir) / "build" / (name or f"{pid}_maps_{stamp}")


def cmd_init(a):
    d = Path(a.project)
    d.mkdir(parents=True, exist_ok=True)
    (d / "inputs").mkdir(exist_ok=True)
    target = d / "project.yaml"
    if target.exists() and not a.force:
        sys.exit(f"{target} already exists. Use --force to replace it.")
    text = (HERE.parent / "assets" / "templates" / "project.yaml").read_text(encoding="utf-8")
    if a.place:
        text = text.replace('place: "City, ST"', f'place: "{a.place}"')
    text = text.replace("date: 2026-01-01", f"date: {datetime.date.today().isoformat()}")
    target.write_text(text, encoding="utf-8")
    log(f"Wrote {target}. Edit it, put any client data in {d / 'inputs'}, then run: tgis.py render {d}  (look at the PNGs, repeat), then tgis.py build {d}")


def cmd_build(a, render_only=False):
    from tgis import resolve
    t0 = time.time()
    if getattr(a, "offline", False):
        os.environ["TGIS_OFFLINE"] = "1"
    project = Path(a.project).resolve()
    spec = resolve.load_yaml(project)
    pkg = pkg_dir(project, spec, getattr(a, "name", None))
    if pkg.exists() and not render_only and not getattr(a, "keep", False):
        native = pkg / "arcgis" / "native"
        keep = None
        if native.exists():          # never throw away a native ArcGIS Pro build or its reports
            keep = pkg.parent / (pkg.name + "_native_keep")
            shutil.move(str(native), str(keep))
        shutil.rmtree(pkg)
        if keep:
            (pkg / "arcgis").mkdir(parents=True)
            shutil.move(str(keep), str(pkg / "arcgis" / "native"))
    pkg.mkdir(parents=True, exist_ok=True)
    log(f"Package: {pkg}")
    from osgeo import gdal
    gdal.PushErrorHandler("CPLQuietErrorHandler")   # GDAL prints a warning for every invalid ring it repairs; real failures still raise
    package = resolve.resolve(project, pkg, log=log)
    log(f"  data and layout: {time.time() - t0:.0f} s")
    outs = package["outputs"]

    log("QGIS project and figures")
    from tgis import qgis_builder
    formats = tuple(f for f in ("pdf", "png", "svg") if f in outs) or ("pdf", "png", "svg")
    qgis_builder.build(pkg, export=True, formats=formats, only=getattr(a, "only", None), log=log)
    from osgeo import gdal, ogr
    gdal.AllRegister(); ogr.RegisterAll()     # QGIS unregisters the GDAL drivers when it shuts down
    if render_only:
        log(f"Rendered in {time.time() - t0:.0f} s. Look at {pkg / 'maps' / 'png'}")
        return pkg

    from tgis import docs, illustrator, kml, package as packaging, qa, review, web
    log("Outputs")
    ill = illustrator.build(pkg, package, log=log) if "illustrator" in outs else {}
    packaging.figures_pdf(pkg, package, log=log)
    if "kmz" in outs:
        kml.build(pkg, package, log=log)
    rstate = review.state(project, pkg, package)
    (pkg / "qa").mkdir(exist_ok=True)
    (pkg / "qa" / "review.json").write_text(json.dumps(rstate, indent=2), encoding="utf-8")
    docs.build(pkg, package, log=log)          # first pass so the builders and prompts exist for QA
    packaging.archive_sources(pkg, project, package, log=log)
    if not getattr(a, "no_rebuild_check", False):
        packaging.rebuild_check(pkg, log=log)
    if "web" in outs:
        web.build(pkg, package, review=rstate, log=log)
    log("Checks")
    summary = qa.run(pkg, log=log)
    summary["n_swatches"] = ill.get("swatches", "all")
    summary["review"] = rstate
    docs.build(pkg, package, qa=summary, log=lambda *_: None)   # second pass writes the verification section
    release = getattr(a, "release", False)
    if release and (rstate["blockers"] or summary["failed"]):
        log("")
        log("NOT A RELEASE. --release was asked for, but:")
        for b_ in rstate["blockers"] + ([f"{summary['failed']} automated checks failed"] if summary["failed"] else []):
            log("  - " + b_)
        log("The package is built as a review package. Record reviews with `tgis.py attest`, resolve the items, and build again.")
        release = False
    (pkg / "RELEASE.txt" if release else pkg / "REVIEW_PACKAGE.txt").write_text(
        ("Release package: every review gate passed on these figures.\n" if release else
         "Review package, not a release. Open items:\n" + "".join("- " + b_ + "\n" for b_ in rstate["blockers"])), encoding="utf-8")
    if "zip" in outs:
        packaging.make_zip(pkg, log=log)
    log("")
    log(f"Done in {time.time() - t0:.0f} s. {summary['passed']} of {summary['checks']} automated checks passed. " + ("RELEASE package." if release else "Review package."))
    log(f"Open {pkg / 'index.html'}")
    if summary["failed"]:
        log("Fix the failed checks above, then rebuild. See qa/qa_report.md.")
    log("The automated checks cover files, page sizes, fonts, text and data. They cannot judge whether a map reads well.")
    log("Next: look at every PNG in maps/png and the sheets in qa/, then get the independent review, before calling the package finished.")
    return pkg


def cmd_attest(a):
    from tgis import resolve, review
    project = Path(a.project).resolve()
    pkg = pkg_dir(project, resolve.load_yaml(project), a.name)
    if not pkg.exists():
        sys.exit(f"No package at {pkg}. Build first, or give --name.")
    review.attest(project, pkg, a.gate, a.reviewer, a.note, a.evidence, status="failed" if a.failed else "passed")
    log(f"Recorded {a.gate}: {'failed' if a.failed else 'passed'} by {a.reviewer}. Rebuild so the package carries the record.")


def cmd_verify(a):
    from tgis import package as packaging
    problems = packaging.verify(Path(a.package).resolve())
    for p_ in problems:
        log(p_)
    log("Package matches its manifest." if not problems else f"{len(problems)} problem(s).")
    sys.exit(1 if problems else 0)


def cmd_rebuild_check(a):
    from tgis import package as packaging
    r = packaging.rebuild_check(Path(a.package).resolve(), log=log)
    sys.exit(0 if r["status"] == "identical" else 1)


def cmd_qa(a):
    from tgis import qa
    s = qa.run(Path(a.package).resolve(), log=log)
    sys.exit(1 if s["failed"] else 0)


def cmd_doctor(a):
    """Check that this computer can build a package."""
    ok = True

    def check(name, fn, need=True):
        nonlocal ok
        try:
            log(f"  ok    {name}: {fn()}")
        except Exception as e:  # noqa: BLE001
            log(f"  {'FAIL ' if need else 'note '} {name}: {e}")
            ok = ok and not need

    def qgis():
        import os
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from qgis.core import Qgis
        v = Qgis.QGIS_VERSION
        if int(Qgis.QGIS_VERSION_INT) < 33400:
            raise RuntimeError(f"QGIS {v} found; 3.34 or later is needed")
        return v

    def gdal():
        from osgeo import gdal as g, ogr
        for d in ("GPKG", "OSM", "GeoJSON"):
            if ogr.GetDriverByName(d) is None:
                raise RuntimeError(f"GDAL has no {d} driver")
        return g.__version__

    def mods():
        import fitz, jinja2, numpy, PIL, pyproj, requests, yaml  # noqa: F401
        return "PyMuPDF, Jinja2, NumPy, Pillow, pyproj, requests, PyYAML"

    def font():
        import subprocess
        out = subprocess.run(["fc-list", "Inter"], capture_output=True, text=True).stdout
        if "Inter" not in out:
            raise RuntimeError("Inter is not installed system-wide; the kit loads its bundled copy, which is fine for building")
        return "Inter installed"

    def net():
        import requests
        r = requests.get("https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer?f=json", timeout=20)
        r.raise_for_status()
        return "Census TIGERweb reachable"

    def key():
        import os
        if not os.environ.get("CENSUS_API_KEY"):
            raise RuntimeError("CENSUS_API_KEY is not set; `acs:` sources will not work (use an `arcgis:` source instead)")
        return "CENSUS_API_KEY set"

    check("QGIS Python bindings", qgis)
    check("GDAL", gdal)
    check("Python modules", mods)
    check("Font", font, need=False)
    check("Network", net, need=False)
    check("Census API key", key, need=False)
    log("Ready to build." if ok else "Not ready. On Debian or Ubuntu: sudo apt install qgis python3-qgis python3-gdal python3-pymupdf python3-yaml python3-jinja2 python3-pil python3-pyproj python3-requests")
    sys.exit(0 if ok else 1)


def cmd_corridor(a):
    from tgis import tools
    d = Path(a.project)
    tools.corridor(a.street, a.place, d / "inputs" / (a.out or "corridor.geojson"), d / "cache", log=log)


def cmd_inspect(a):
    from tgis import tools
    tools.inspect(a.source, a.place, Path(a.cache or "/tmp/tgis_inspect_cache"), log=log)


def cmd_presets(a):
    from tgis import styles
    P = styles.presets()
    for name, p in P.items():
        if name == "ramps":
            log("ramps: " + ", ".join(p))
            continue
        kind = p.get("type", "simple")
        extra = f", field `{p['field']}`" if p.get("field") else ""
        labels = "; ".join(c["label"] for c in p["classes"]) if isinstance(p.get("classes"), list) else p.get("label", "")
        log(f"{name:26} {kind}{extra}: {labels}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("init"); s.add_argument("project"); s.add_argument("--place"); s.add_argument("--force", action="store_true")
    s = sub.add_parser("build"); s.add_argument("project"); s.add_argument("--name", help="package folder name (default <id>_maps_<date>)")
    s.add_argument("--offline", action="store_true", help="use only the archived downloads in cache/; fail on any download attempt")
    s.add_argument("--release", action="store_true", help="label the package a release; refused unless every review gate has passed")
    s.add_argument("--no-rebuild-check", action="store_true", help="skip the offline rebuild-and-compare test")
    s = sub.add_parser("attest", help="record that a review gate passed, with evidence")
    s.add_argument("project"); s.add_argument("gate"); s.add_argument("--reviewer", required=True); s.add_argument("--note", required=True)
    s.add_argument("--evidence", action="append", required=True); s.add_argument("--failed", action="store_true"); s.add_argument("--name")
    s = sub.add_parser("verify", help="check an extracted package against its MANIFEST.sha256"); s.add_argument("package")
    s = sub.add_parser("rebuild-check", help="rebuild a package offline from its own source/ and tools/ in a scratch folder and compare figures"); s.add_argument("package")
    s = sub.add_parser("render"); s.add_argument("project"); s.add_argument("--only", nargs="*"); s.add_argument("--name")
    s.add_argument("--offline", action="store_true")
    s = sub.add_parser("qa"); s.add_argument("package")
    sub.add_parser("presets")
    sub.add_parser("doctor")
    s = sub.add_parser("corridor", help="write inputs/corridor.geojson: one line along a named street, from OpenStreetMap")
    s.add_argument("project"); s.add_argument("--street", required=True); s.add_argument("--place", required=True); s.add_argument("--out")
    s = sub.add_parser("inspect", help="list the fields and class values of a file or an ArcGIS REST layer")
    s.add_argument("source"); s.add_argument("--place", help='limit a service query to a place, for example "City, ST"'); s.add_argument("--cache")
    a = ap.parse_args()
    if a.cmd == "init":
        cmd_init(a)
    elif a.cmd == "build":
        cmd_build(a)
    elif a.cmd == "render":
        cmd_build(a, render_only=True)
    elif a.cmd == "qa":
        cmd_qa(a)
    elif a.cmd == "attest":
        cmd_attest(a)
    elif a.cmd == "verify":
        cmd_verify(a)
    elif a.cmd == "rebuild-check":
        cmd_rebuild_check(a)
    elif a.cmd == "doctor":
        cmd_doctor(a)
    elif a.cmd == "corridor":
        cmd_corridor(a)
    elif a.cmd == "inspect":
        cmd_inspect(a)
    else:
        cmd_presets(a)


if __name__ == "__main__":
    main()
