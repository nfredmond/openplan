"""After the dependent merge deploys: does the app expect exactly the history the database holds?

    python health_readback.py --url https://openplan-zeta.vercel.app/api/health \
        --commit MERGE_SHA --catalog CATALOG_ENVELOPE.json

/api/health reports the deployed commit and the migration count and newest
version the build expects. It cannot read applied history (finding F13), so
the applied side comes from a catalog read after the install (its hist: keys).
Passes only when the commit matches the merge commit, and expected count and
newest version equal the read history. Reads the public route only; no token.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import urllib.request

import kitcommon as kc


def applied_history(catalog_envelope: dict) -> tuple[int, str]:
    if catalog_envelope.get("status") != "read" or "map" not in (catalog_envelope.get("result") or {}):
        raise kc.KitError("--catalog is not a completed catalog read")
    versions = sorted(k[len("hist:"):] for k in catalog_envelope["result"]["map"] if k.startswith("hist:"))
    if not versions:
        raise kc.KitError("the catalog read holds no migration history")
    return len(versions), versions[-1]


def check(health: dict, commit: str, applied: tuple[int, str]) -> dict:
    # The route nests both facts under "deployment":
    # {"status": "ok", "deployment": {"commit": "...", "migrations": {"expected": n, "latest": "..."}}}.
    # A response without that object is refused, never read as a mismatch or a pass.
    deployment = health.get("deployment")
    if health.get("status") != "ok" or not isinstance(deployment, dict):
        raise kc.KitError("/api/health did not return status ok with a deployment object")
    served = str(deployment.get("commit") or "")
    migrations = deployment.get("migrations") or {}
    commit_ok = len(served) >= 7 and len(commit) >= 7 and (commit.startswith(served) or served.startswith(commit))
    count_ok = migrations.get("expected") == applied[0]
    latest_ok = migrations.get("latest") == applied[1]
    return {"pass": commit_ok and count_ok and latest_ok, "servedCommit": served, "mergeCommit": commit,
            "expected": migrations.get("expected"), "expectedLatest": migrations.get("latest"),
            "appliedCount": applied[0], "appliedLatest": applied[1],
            "commitMatches": commit_ok, "countMatches": count_ok, "latestMatches": latest_ok}


def fetch(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "Cache-Control": "no-cache"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def main(argv: list[str] | None = None, fetcher=fetch) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--url", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--catalog", required=True)
    args = parser.parse_args(argv)
    try:
        result = check(fetcher(args.url), args.commit, applied_history(kc.read_json(pathlib.Path(args.catalog))))
    except kc.KitError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    print(json.dumps(result))
    return 0 if result["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
