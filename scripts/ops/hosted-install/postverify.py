"""Check a target's whole catalog after the install against the dry run it was pinned from.

    python postverify.py --pins DRYRUN_ENVELOPE.json --catalog CATALOG_ENVELOPE.json --out EVIDENCE.json

DRYRUN_ENVELOPE is the dry run the install was built from (bundle.json
pinnedFrom names it). CATALOG_ENVELOPE is run_sql.py catalog, read after the
install. The expected map is the dry run's before map with its changes
applied; the current map must equal it key for key. This covers the history
rows (hist: keys), so 455 rows through the newest version is part of the
check. The post-verify hash is SHA-256 over the changed keys' current values,
recorded for the window record.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import kitcommon as kc


def expected_after(dryrun: dict) -> dict[str, str]:
    expected = dict(dryrun["before"])
    for key, change in dryrun["delta"].items():
        if change.get("after") is None:
            expected.pop(key, None)
        else:
            expected[key] = change["after"]
    return expected


def check(dryrun_envelope: dict, catalog_envelope: dict) -> dict:
    if dryrun_envelope.get("status") != "dry-run-complete":
        raise kc.KitError("--pins is not a completed dry run")
    if catalog_envelope.get("status") != "read" or "map" not in (catalog_envelope.get("result") or {}):
        raise kc.KitError("--catalog is not a completed catalog read")
    dryrun = dryrun_envelope["result"]
    current = catalog_envelope["result"]["map"]
    if kc.map_digest(current) != catalog_envelope["result"]["digest"]:
        raise kc.KitError("catalog envelope is inconsistent: its map does not give its digest")
    expected = expected_after(dryrun)
    missing = sorted(set(expected) - set(current))
    extra = sorted(set(current) - set(expected))
    changed = sorted(k for k in set(expected) & set(current) if expected[k] != current[k])
    changed_keys = sorted(dryrun["delta"])
    lines = "\n".join(f"{k}={current.get(k)}" for k in changed_keys)
    return {"pass": not (missing or extra or changed), "expectedDigest": kc.map_digest(expected),
            "currentDigest": catalog_envelope["result"]["digest"], "missing": missing[:200],
            "extra": extra[:200], "changed": changed[:200], "changedKeysChecked": len(changed_keys),
            "postverifySha256": kc.sha256_bytes(lines.encode("utf-8"))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for name in ("--pins", "--catalog", "--out"):
        parser.add_argument(name, required=True)
    args = parser.parse_args(argv)
    try:
        result = check(kc.read_json(pathlib.Path(args.pins)), kc.read_json(pathlib.Path(args.catalog)))
    except kc.KitError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    kc.write_new(pathlib.Path(args.out), json.dumps(result, indent=2) + "\n")
    print(json.dumps({k: result[k] for k in ("pass", "changedKeysChecked", "postverifySha256")}
                     | {"differences": len(result["missing"]) + len(result["extra"]) + len(result["changed"])}))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
