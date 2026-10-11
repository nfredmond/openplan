#!/usr/bin/env python3
"""Do the automated checks fail when they should?

Takes a built package, copies it, breaks one thing per case, and requires the matching check to
fail. An untouched copy must pass. A check that cannot fail proves nothing, so run this after
changing qa.py, review.py or package.py.

  python3 tests/test_checks.py <built package folder> [<project folder>]

(Mutation testing of the checks follows the practice in GPT-6-Astra's qa/run_mutations.py.)
"""
import json
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PIL import Image  # noqa: E402

from tgis import package as packaging  # noqa: E402
from tgis import qa, review  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


def failed_checks(pkg):
    s = qa.run(pkg, log=lambda *a: None)
    return [i["check"] for i in s["items"] if not i["passed"] and i["level"] == "fail"]


def spec_edit(pkg, fn):
    p = pkg / "spec" / "map_package.json"
    d = json.loads(p.read_text())
    fn(d)
    p.write_text(json.dumps(d))


def main():
    src = Path(sys.argv[1]).resolve()
    first = json.loads((src / "spec" / "map_package.json").read_text())["maps"][0]["id"]

    def m_delete_pdf(p):
        (p / "maps" / "pdf" / f"{first}.pdf").unlink()

    def m_blank_png(p):
        f = p / "maps" / "png" / f"{first}.png"
        im = Image.open(f)
        Image.new("RGB", im.size, "#f5f4ef").save(f)

    def m_em_dash(p):
        (p / "README.md").write_text((p / "README.md").read_text() + "\nA line with an em dash " + chr(0x2014) + " here.\n")

    def m_home_path(p):
        (p / "docs" / "figure_notes.md").write_text((p / "docs" / "figure_notes.md").read_text() + "\n" + str(Path.home()) + "/secret\n")

    def m_no_alt(p):
        spec_edit(p, lambda d: d["maps"][0].update(alt=""))

    def m_truncated(p):
        spec_edit(p, lambda d: d["maps"][0].update(truncated=["notes"]))

    def m_legend_overflow(p):
        spec_edit(p, lambda d: d["maps"][0]["legend"].update(h=d["maps"][0]["legend"]["available"] + 2))

    def m_bad_field(p):
        def f(d):
            l = next(l for m in d["maps"] for l in m["layers"] if l["renderer"].get("field"))
            l["renderer"]["field"] = "no_such_field"
        spec_edit(p, f)

    def m_broken_link(p):
        shutil.rmtree(p / "web" / "thumbs")

    def m_corrupt_kmz(p):
        next((p / "google-earth").glob("*.kmz")).write_bytes(b"not a zip")

    def m_missing_source(p):
        f = next(x for x in (p / "source" / "cache").iterdir() if x.name != "provenance.json")
        f.unlink()

    def m_live_text_in_outlined(p):
        f = p / "maps" / "svg_outlined" / f"{first}.svg"
        f.write_text(f.read_text().replace("</svg>", "<text>x</text></svg>"))

    cases = [
        ("delete a figure PDF", m_delete_pdf, "pdf exists"),
        ("blank the map frame of a PNG", m_blank_png, "map frame is not blank"),
        ("em dash in README", m_em_dash, "no em dash in any document"),
        ("home folder path in a document", m_home_path, "home folder path"),
        ("remove alt text", m_no_alt, "alt text written"),
        ("flag truncated text", m_truncated, "no text was cut"),
        ("legend taller than its space", m_legend_overflow, "legend fits"),
        ("spec names a field the data lacks", m_bad_field, "preflight: every layer"),
        ("delete the gallery thumbnails", m_broken_link, "every link and asset"),
        ("corrupt the KMZ", m_corrupt_kmz, "KMZ parses"),
        ("delete an archived source file", m_missing_source, "every original download"),
        ("live text in the outlined SVG", m_live_text_in_outlined, "outlined SVG"),
    ]
    results, ok = [], True
    with tempfile.TemporaryDirectory(prefix="tgis_checks_") as tmp:
        base = Path(tmp) / "control"
        shutil.copytree(src, base, ignore=shutil.ignore_patterns("native"))
        control = failed_checks(base)
        results.append({"case": "untouched copy", "expect": "no failures", "ok": not control, "failed": control})
        ok &= not control
        for name, mutate, expect in cases:
            work = Path(tmp) / "case"
            if work.exists():
                shutil.rmtree(work)
            shutil.copytree(src, work, ignore=shutil.ignore_patterns("native"))
            mutate(work)
            fails = failed_checks(work)
            hit = any(expect in f for f in fails)
            results.append({"case": name, "expect": expect, "ok": hit, "failed": fails[:4]})
            ok &= hit
        # Manifest and review gate probes
        work = Path(tmp) / "case"
        shutil.rmtree(work)
        shutil.copytree(src, work, ignore=shutil.ignore_patterns("native"))
        clean = packaging.verify(work)
        with open(work / "README.md", "a") as f:
            f.write("tampered\n")
        tampered = packaging.verify(work)
        hit = not clean and any("README.md" in x for x in tampered)
        results.append({"case": "edit a file after the manifest was written", "expect": "verify reports it", "ok": hit, "failed": tampered[:2]})
        ok &= hit
        proj = Path(tmp) / "proj"
        proj.mkdir()
        ev = proj / "note.md"
        ev.write_text("reviewed")
        package = json.loads((work / "spec" / "map_package.json").read_text())
        review.attest(proj, work, "cartography", "probe", "probe", [str(ev)])
        fresh = next(g for g in review.state(proj, work, package)["gates"] if g["gate"] == "cartography")["status"]
        f = work / "maps" / "png" / f"{first}.png"
        Image.new("RGB", (10, 10)).save(f)
        stale = next(g for g in review.state(proj, work, package)["gates"] if g["gate"] == "cartography")["status"]
        hit = fresh == "passed" and stale.startswith("stale")
        results.append({"case": "change a figure after its review", "expect": "gate goes stale", "ok": hit, "failed": [fresh, stale]})
        ok &= hit
    for r in results:
        print(("ok    " if r["ok"] else "FAIL  ") + r["case"] + "  ->  " + r["expect"] + ("" if r["ok"] else "   got: " + str(r["failed"])))
    out = src / "qa" / "check_probes.json"
    print(f"{sum(r['ok'] for r in results)} of {len(results)} probes behaved as required.")
    if len(sys.argv) > 2:
        Path(sys.argv[2]).mkdir(parents=True, exist_ok=True)
        (Path(sys.argv[2]) / "check_probes.json").write_text(json.dumps(results, indent=1))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
