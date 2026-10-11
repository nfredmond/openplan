"""Review gates: what has been looked at, by whom, with what evidence.

A build that ran is not a reviewed package. Each gate records a reviewer, a note, evidence files
and a fingerprint of the figures at the time. If the figures change afterwards the gate reads as
stale. `build --release` refuses to label a package as a release until every gate has passed on
the current figures and no placeholder remains.

The record lives in <project>/review.json so it survives rebuilds. It is copied into each package
as qa/review.json. (The gate idea, evidence hashes and stale detection follow GPT-6-Astra's
package.py; the code here is written for this kit.)
"""
from __future__ import annotations

import datetime
import hashlib
import json
import re
import shutil
from pathlib import Path

GATES = {
    "data": "Sources, vintages, counts and terms checked against the publisher or the agency's records",
    "cartography": "Every figure and map book sheet reviewed at print size by someone who did not make it",
    "qgis": "QGIS project opened in QGIS Desktop; layouts match the reference figures",
    "arcgis": "ArcGIS Pro project built on a computer with ArcGIS Pro and compared with the reference figures",
    "illustrator": "Illustrator script run; layers, live type and artboards checked",
    "google_earth": "KMZ opened in Google Earth; layers, symbols and pop-ups checked",
    "browser": "index.html opened from the file system in a desktop browser; links and interactive map checked",
}
PLACEHOLDER = re.compile(r"\[(?:VERIFY|CLIENT|ALT TEXT|[A-Z][A-Z ]+ (?:NEEDED|TO BE ADDED))[^\]]*\]")


def fingerprint(pkg: Path) -> str:
    """One hash over every figure and map book sheet PNG: changes when any reviewed page changes."""
    h = hashlib.sha256()
    # PNGs only: they are bit-identical between rebuilds of the same data, while PDFs carry a creation time.
    for f in sorted(list((pkg / "maps" / "png").glob("*.png")) + list((pkg / "atlas" / "sheets").glob("*.png"))):
        h.update(f.name.encode())
        h.update(hashlib.sha256(f.read_bytes()).digest())
    return h.hexdigest()


def load(project_dir: Path) -> dict:
    p = Path(project_dir) / "review.json"
    rec = json.loads(p.read_text(encoding="utf-8")) if p.exists() else {"gates": {}}
    for g in GATES:
        rec["gates"].setdefault(g, {"status": "pending"})
    return rec


def attest(project_dir: Path, pkg: Path, gate: str, reviewer: str, note: str, evidence: list[str], status="passed"):
    if gate not in GATES:
        raise ValueError(f"Unknown gate {gate!r}. Gates: {', '.join(GATES)}")
    if not evidence:
        raise ValueError("Give at least one --evidence file (a review report, a build report, a screenshot).")
    project_dir = Path(project_dir)
    ev_dir = project_dir / "review_evidence" / gate
    ev_dir.mkdir(parents=True, exist_ok=True)
    files = {}
    for e in evidence:
        src = Path(e)
        if not src.is_file() or not src.stat().st_size:
            raise ValueError(f"Evidence file missing or empty: {e}")
        dst = ev_dir / src.name
        if src.resolve() != dst.resolve():
            shutil.copy(src, dst)
        files[f"review_evidence/{gate}/{src.name}"] = hashlib.sha256(dst.read_bytes()).hexdigest()
    rec = load(project_dir)
    rec["gates"][gate] = {"status": status, "reviewer": reviewer, "date": datetime.date.today().isoformat(), "note": note,
                          "evidence": files, "figures": fingerprint(pkg)}
    (project_dir / "review.json").write_text(json.dumps(rec, indent=2), encoding="utf-8")
    return rec


def state(project_dir: Path, pkg: Path, package: dict) -> dict:
    """Gate table for this package plus the list of things that block a release."""
    project_dir = Path(project_dir)
    rec = load(project_dir)
    fp = fingerprint(pkg)
    rows, blockers = [], []
    for g, what in GATES.items():
        r = rec["gates"][g]
        st = r.get("status", "pending")
        if st == "passed":
            if r.get("figures") != fp:
                st = "stale (figures changed since review)"
            else:
                for rel, digest in (r.get("evidence") or {}).items():
                    f = project_dir / rel
                    if not f.is_file() or hashlib.sha256(f.read_bytes()).hexdigest() != digest:
                        st = "evidence missing or changed"
        rows.append({"gate": g, "what": what, "status": st, "reviewer": r.get("reviewer", ""), "date": r.get("date", ""), "note": r.get("note", "")})
        if st != "passed":
            blockers.append(f"Review gate not passed: {g} ({st})")
    text = json.dumps({k: package[k] for k in ("project", "maps", "atlases")}, default=str)
    found = sorted(set(PLACEHOLDER.findall(text)))
    if found:
        blockers.append("Placeholders remain: " + "; ".join(found[:6]))
    if package["project"].get("practice"):
        blockers.append("Practice package (project.practice is true): never a client release")
    if (package["project"].get("status") or "").lower() != "final":
        blockers.append("project.status is not final")
    return {"gates": rows, "blockers": blockers, "figures": fp, "release_ready": not blockers}
