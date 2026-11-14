"""Procedure step 16: the whole window on the restored copy of the window's capture.

    python rehearse_copy.py --plan WINDOW/plan.json --repo REPO --container NAME --window WINDOW

In WINDOW/copy-run (created; must not exist):
  1. Build the dry-run bundle from the plan.
  2. Read the copy's whole catalog, run DRYRUN.sql, read it again. The digest
     must be unchanged and history must still read the plan's count (B2.4).
  3. Build INSTALL.sql pinned to the copy's own dry run, write GO for the
     copy, install once, read the catalog, and post-verify against the dry
     run (the whole catalog equals the before map with the changes applied).
Stops at the first failure and says which step. Prints one JSON summary.
The copy's change map (copy-run/dryrun-*.json) is what compare_maps.py later
compares with the hosted dry run.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import build_install
import kitcommon as kc
import postverify
import run_sql
import sqllex


def step(args, mode, target, out, **extra):
    namespace = argparse.Namespace(mode=mode, out=str(out), bundle=extra.get("bundle"), file=None, var=[])
    code, envelope = run_sql.execute(namespace, target)
    return code, envelope


def run(args) -> dict:
    window = pathlib.Path(args.window)
    out = window / "copy-run"
    if out.exists():
        raise kc.KitError(f"{out} exists; each copy run gets a fresh folder")
    bundle_dir = out / "bundle"
    target = run_sql.CopyTarget(args.container)
    plan = build_install.load_plan(pathlib.Path(args.plan))
    summary: dict = {"window": plan["window"], "capture": plan["capture"], "container": args.container}
    built = build_install.build(argparse.Namespace(mode="dryrun", plan=args.plan, repo=args.repo, out=str(bundle_dir), pins=None))
    summary["dryrunSha256"] = built["dryrunSha256"]

    code, before = step(args, "catalog", target, out)
    if code:
        raise kc.KitError("catalog read before the dry run failed")
    code, dry = step(args, "dryrun", target, out, bundle=str(bundle_dir))
    if code:
        raise kc.KitError(f"dry run on the copy did not complete: {dry.get('stderrTail', '')[-300:]}")
    code, after = step(args, "catalog", target, out)
    if code:
        raise kc.KitError("catalog read after the dry run failed")
    if before["result"]["digest"] != after["result"]["digest"]:
        raise kc.KitError("the copy's catalog changed across the rollback-only dry run")
    hist = sum(1 for k in after["result"]["map"] if k.startswith("hist:"))
    if hist != plan["history"]["count"]:
        raise kc.KitError(f"history reads {hist} after the dry run, expected {plan['history']['count']}")
    summary.update(digestUnchanged=True, historyAfterDryRun=hist, dryRunMs=dry["elapsedMs"],
                   dryRunLockMs=dry["lockHeldMs"], changedKeys=len(dry["result"]["delta"]))

    pins = out / [p for p in sorted(out.iterdir()) if p.name.startswith("dryrun-") and p.suffix == ".json"][0].name
    installed = build_install.build(argparse.Namespace(mode="install", plan=args.plan, repo=args.repo, out=str(bundle_dir), pins=str(pins)))
    go = {"capture": plan["capture"], "installSha256": installed["installSha256"], "target": "copy"}
    kc.write_new(bundle_dir / "GO.json", json.dumps(go, indent=2) + "\n")
    code, inst = step(args, "install", target, out, bundle=str(bundle_dir))
    if code:
        raise kc.KitError(f"install on the copy failed: {inst.get('stderrTail', '')[-300:]}")
    code, final = step(args, "catalog", target, out)
    if code:
        raise kc.KitError("catalog read after the install failed")
    check = postverify.check(kc.read_json(pins), final)
    kc.write_new(out / "postverify.json", json.dumps(check, indent=2) + "\n")
    if not check["pass"]:
        raise kc.KitError("post-verify on the copy failed; see copy-run/postverify.json")
    versions = sorted(k[5:] for k in final["result"]["map"] if k.startswith("hist:"))
    summary.update(installSha256=installed["installSha256"], installMs=inst["elapsedMs"], installLockMs=inst["lockHeldMs"],
                   historyAfterInstall=len(versions), newest=versions[-1],
                   postverifySha256=check["postverifySha256"], afterDigest=final["result"]["digest"])
    kc.write_new(out / "summary.json", json.dumps(summary, indent=2) + "\n")
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for name in ("--plan", "--repo", "--container", "--window"):
        parser.add_argument(name, required=True)
    args = parser.parse_args(argv)
    try:
        summary = run(args)
    except (kc.KitError, sqllex.SqlRefused) as error:
        print(f"STOP: {error}", file=sys.stderr)
        return 1
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
