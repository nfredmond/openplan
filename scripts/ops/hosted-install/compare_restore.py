"""Pass or stop a restore on the four review 15 B7 criteria, with no judgment call.

    python compare_restore.py --copy COPY_READBACK.json --source SOURCE_READBACK.json \
        --manifest DIR/<stamp>/manifest.json --probes PROBE_ENVELOPE.json --out EVIDENCE.json

COPY_READBACK and SOURCE_READBACK are run_sql.py read envelopes of
restore_readback.sql, the source one taken within 10 minutes after the
capture's completion line, both with --var capture_started=<capturedAt>.

  1. Exact counts. A table whose count differs passes only when the source
     shows rows created or updated at or after the capture started.
  2. Ordered primary-key md5 for workspaces, workspace members, projects,
     auth users and buckets: equal, or the same timestamp explanation.
  3. Storage: every copy storage.objects row has a manifest entry with the
     same bucket and name and bytes equal to metadata size, and every manifest
     entry has a row. A mismatch passes only when that row's timestamp (copy
     or source) is at or after the capture started.
  4. Boundary probes on the copy: owner 1, other workspace 0, anonymous 0.

History (count, newest, tuple hash), buckets and event triggers must match
exactly. Every difference is listed, explained or not. Exit 0 only on pass.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

import kitcommon as kc

KEY_TABLES = ["public.workspaces", "public.workspace_members", "public.projects", "auth.users", "storage.buckets"]


def _result(envelope: dict, label: str) -> dict:
    result = envelope.get("result")
    if envelope.get("status") != "read" or not isinstance(result, dict) or result.get("kind") != "restore-readback":
        raise kc.KitError(f"{label} is not a completed restore readback")
    return result


def _ts(value) -> dt.datetime | None:
    if not value:
        return None
    text = str(value).replace("Z", "+00:00")
    parsed = dt.datetime.fromisoformat(text)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=dt.timezone.utc)


def compare(copy: dict, source: dict, manifest: dict, probes: list[dict]) -> dict:
    started = _ts(manifest["capturedAt"])
    if _ts(copy.get("captureStarted")) != started or _ts(source.get("captureStarted")) != started:
        raise kc.KitError("both readbacks must use --var capture_started equal to the manifest's capturedAt")
    explained, unexplained = [], []

    def note(ok: bool, item: dict) -> None:
        (explained if ok else unexplained).append(item)

    for key in ("count", "newest", "tupleHash"):
        if copy["history"][key] != source["history"][key]:
            unexplained.append({"check": "history", "field": key, "copy": copy["history"][key], "source": source["history"][key]})
    for key in ("buckets", "eventTriggers"):
        if copy[key] != source[key]:
            unexplained.append({"check": key, "copy": copy[key], "source": source[key]})

    # 1. exact counts
    tables = sorted(set(copy["tables"]) | set(source["tables"]))
    for name in tables:
        c, s = copy["tables"].get(name), source["tables"].get(name)
        if c is None or s is None:
            unexplained.append({"check": "table-present", "table": name, "copy": c is not None, "source": s is not None})
            continue
        if c["count"] != s["count"]:
            recent = s.get("recent") or 0
            note(recent > 0, {"check": "count", "table": name, "copy": c["count"], "source": s["count"],
                              "sourceRowsSinceCaptureStart": s.get("recent")})

    # 2. key hashes
    for name in KEY_TABLES:
        c, s = copy["keyHashes"].get(name), source["keyHashes"].get(name)
        if c is None or s is None:
            unexplained.append({"check": "key-hash-present", "table": name})
            continue
        if c["md5"] != s["md5"]:
            recent = (source["tables"].get(name) or {}).get("recent") or 0
            note(recent > 0, {"check": "key-hash", "table": name, "sourceRowsSinceCaptureStart": recent})

    # 3. storage reconciliation
    rows = {(o[0], o[1]): o for o in copy["objects"]}
    source_rows = {(o[0], o[1]): o for o in source["objects"]}
    entries = {(m["bucket"], m["path"]): m for m in manifest["objects"]}

    def recent_row(row) -> bool:
        return row is not None and any((_ts(t) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= started for t in row[3:5])

    for key, row in sorted(rows.items()):
        entry = entries.get(key)
        if entry is None:
            note(recent_row(row), {"check": "object-without-file", "bucket": key[0], "name": key[1]})
        elif row[2] is None or int(row[2]) != entry["bytes"]:
            note(recent_row(row) or recent_row(source_rows.get(key)),
                 {"check": "object-size", "bucket": key[0], "name": key[1], "rowSize": row[2], "fileBytes": entry["bytes"]})
    for key in sorted(set(entries) - set(rows)):
        note(recent_row(source_rows.get(key)), {"check": "file-without-row", "bucket": key[0], "name": key[1]})

    # 4. boundary probes
    found = {p.get("probe"): p for p in probes}
    picked = found.get("picked") or {}
    expected = {"owner": 1, "other-workspace": 0, "anon": 0}
    probe_results = {}
    if not (picked.get("project") and picked.get("owner") and picked.get("other")):
        unexplained.append({"check": "probe-subjects", "picked": picked})
    for name, rows_expected in expected.items():
        got = (found.get(name) or {}).get("rows")
        probe_results[name] = got
        if got != rows_expected:
            unexplained.append({"check": "probe", "probe": name, "expected": rows_expected, "rows": got})

    return {
        "pass": not unexplained,
        "captureStarted": manifest["capturedAt"],
        "history": copy["history"],
        "tablesCompared": len(tables),
        "objectsCompared": {"copyRows": len(rows), "manifestEntries": len(entries)},
        "probes": probe_results,
        "explained": explained,
        "unexplained": unexplained,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for name in ("--copy", "--source", "--manifest", "--probes", "--out"):
        parser.add_argument(name, required=True)
    args = parser.parse_args(argv)
    try:
        copy = _result(kc.read_json(pathlib.Path(args.copy)), "--copy")
        source = _result(kc.read_json(pathlib.Path(args.source)), "--source")
        probe_envelope = kc.read_json(pathlib.Path(args.probes))
        if probe_envelope.get("status") != "probe-complete":
            raise kc.KitError("the probe envelope is not a completed probe")
        probes = probe_envelope.get("result")
        probes = probes if isinstance(probes, list) else [probes]
        evidence = compare(copy, source, kc.read_json(pathlib.Path(args.manifest)), probes)
    except kc.KitError as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    kc.write_new(pathlib.Path(args.out), json.dumps(evidence, indent=2) + "\n")
    print(json.dumps({"pass": evidence["pass"], "unexplained": len(evidence["unexplained"]),
                      "explained": len(evidence["explained"]), "probes": evidence["probes"]}))
    return 0 if evidence["pass"] else 1


if __name__ == "__main__":
    sys.exit(main())
