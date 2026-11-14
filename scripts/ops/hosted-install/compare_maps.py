"""Compare the restored copy's dry-run change map with the hosted dry run's (review 15, B3.3).

    python compare_maps.py --copy COPY_DRYRUN.json --hosted HOSTED_DRYRUN.json \
        --allowed allowed_differences.json --out EVIDENCE.json

Both inputs are run_sql.py dryrun envelopes with status dry-run-complete. For
every changed key in either map, the new value hash must be equal, or the key
must be named in allowed_differences.json with a written reason. The file is
made before the window, for example for managed default privileges that grant
EXECUTE on a new function on hosted but not on the copy. It names exact keys:
no patterns, no wildcards. Any other difference stops the window.

allowed_differences.json:  {"allowed": [{"key": "fn:public.f(x integer)", "reason": "..."}]}
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys

import kitcommon as kc


def load_allowed(path: pathlib.Path) -> dict[str, str]:
    data = kc.read_json(path)
    allowed = {}
    for item in data.get("allowed", []):
        key, reason = item.get("key"), (item.get("reason") or "").strip()
        if not key or not reason:
            raise kc.KitError("every allowed difference needs a key and a written reason")
        if any(ch in key for ch in "*?%"):
            raise kc.KitError(f"allowed differences name exact keys, not patterns: {key}")
        allowed[key] = reason
    return allowed


def delta_of(envelope: dict, label: str) -> dict[str, str | None]:
    if envelope.get("status") != "dry-run-complete":
        raise kc.KitError(f"{label} is not a completed dry run")
    return {k: v.get("after") for k, v in envelope["result"]["delta"].items()}


def compare(copy: dict[str, str | None], hosted: dict[str, str | None], allowed: dict[str, str]) -> dict:
    absent = object()
    differences, permitted = [], []
    for key in sorted(set(copy) | set(hosted)):
        a, b = copy.get(key, absent), hosted.get(key, absent)
        if a == b:
            continue
        item = {"key": key, "copy": None if a is absent else a, "hosted": None if b is absent else b,
                "inCopyDelta": a is not absent, "inHostedDelta": b is not absent}
        if key in allowed:
            permitted.append({**item, "reason": allowed[key]})
        else:
            differences.append(item)
    used = {p["key"] for p in permitted}
    return {"pass": not differences, "copyKeys": len(copy), "hostedKeys": len(hosted),
            "differences": differences, "allowed": permitted,
            "unusedAllowances": sorted(set(allowed) - used)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for name in ("--copy", "--hosted", "--allowed", "--out"):
        parser.add_argument(name, required=True)
    args = parser.parse_args(argv)
    try:
        result = compare(delta_of(kc.read_json(pathlib.Path(args.copy)), "--copy"),
                         delta_of(kc.read_json(pathlib.Path(args.hosted)), "--hosted"),
                         load_allowed(pathlib.Path(args.allowed)))
    except kc.KitError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    kc.write_new(pathlib.Path(args.out), json.dumps(result, indent=2) + "\n")
    print(json.dumps({"pass": result["pass"], "differences": len(result["differences"]),
                      "allowed": len(result["allowed"]), "unusedAllowances": len(result["unusedAllowances"])}))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
