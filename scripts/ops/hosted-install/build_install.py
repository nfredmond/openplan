"""Build the rollback-only dry run and the pinned install for one migration window.

    python build_install.py dryrun  --plan PLAN.json --repo REPO --out BUNDLE
    python build_install.py install --plan PLAN.json --repo REPO --out BUNDLE --pins DRYRUN_RESULT.json

The plan names each migration file, the commit it is read from (git show, never
a working tree), its SHA-256 and whether it wraps itself in BEGIN/COMMIT. The
builder refuses a wrong hash, any top-level transaction or session control
(sqllex), and an install without pins from a completed dry run of the same
plan on the same target.

Both files run under psql --single-transaction with ON_ERROR_STOP (run_sql.py):

  1. B5 timeouts, then a guard row holding the transaction id.
  2. The whole catalog map before any change (catalog_keys.sql).
  3. Preconditions: session and current user postgres, postgres not a
     superuser, read-write, history count and newest version as planned, no
     planned version present. The install also requires the history tuple
     hash and whole-catalog digest the dry run read (B3.4).
  4. Each migration statement, each followed by a check that the transaction
     id has not changed (B2.2), then the file's history row.
  5. NOTIFY pgrst (N9), then one statement that reads the catalog map again
     and, in the install, requires the changed-key map (added, removed and
     changed keys with their new value hashes) to equal the dry run's (B3.2).
  6. Post-checks from the plan, if any.
  7. The dry run prints its result, raises, and only then rolls back (B2.3).
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import subprocess
import sys

import kitcommon as kc
import sqllex

PLAN_PURPOSES = {"window", "rehearsal"}
HISTORY_FORMATS = {"whole-file", "statements", "empty"}
_FULL_SHA = re.compile(r"^[0-9a-f]{40}$")
_NAME = re.compile(r"^[a-z0-9_]+$")


def load_plan(path: pathlib.Path) -> dict:
    plan = kc.read_json(path)
    for key in ("window", "purpose", "capture", "history", "historyStatements", "files"):
        if key not in plan:
            raise kc.KitError(f"plan is missing {key}")
    if plan["purpose"] not in PLAN_PURPOSES:
        raise kc.KitError(f"plan purpose must be one of {sorted(PLAN_PURPOSES)}")
    if plan["historyStatements"] not in HISTORY_FORMATS:
        raise kc.KitError(f"historyStatements must be one of {sorted(HISTORY_FORMATS)}")
    if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", plan["capture"]):
        raise kc.KitError("capture must be a capture stamp such as 20261115T120000Z")
    history = plan["history"]
    if not isinstance(history.get("count"), int) or history["count"] < 1:
        raise kc.KitError("history.count must be a positive integer")
    previous = kc.check_version(history.get("newest", ""))
    files = plan["files"]
    if not files:
        raise kc.KitError("plan names no files")
    commits = set()
    for item in files:
        version = kc.check_version(item.get("version", ""))
        if version <= previous:
            raise kc.KitError(f"versions must rise above the current newest: {version} after {previous}")
        previous = version
        if not _NAME.fullmatch(item.get("name", "")):
            raise kc.KitError(f"bad migration name for {version}")
        expected = f"openplan/supabase/migrations/{version}_{item['name']}.sql"
        if item.get("path") != expected:
            raise kc.KitError(f"{version}: path must be {expected}")
        if not _FULL_SHA.fullmatch(item.get("commit", "")):
            raise kc.KitError(f"{version}: commit must be a full 40-character SHA")
        if not re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", "")):
            raise kc.KitError(f"{version}: sha256 must be 64 hex characters")
        if not isinstance(item.get("selfWrapped"), bool):
            raise kc.KitError(f"{version}: selfWrapped must be true or false")
        commits.add(item["commit"])
    # Review 15, B4.2: the window installs the bytes of one frozen integration
    # head. Only a local rehearsal may draw files from several PR branches.
    if plan["purpose"] == "window" and len(commits) != 1:
        raise kc.KitError("a window plan must read every file from one integration commit")
    return plan


def read_file_at(repo: pathlib.Path, commit: str, path: str) -> bytes:
    result = subprocess.run(["git", "-C", str(repo), "show", f"{commit}:{path}"], capture_output=True)
    if result.returncode != 0:
        raise kc.KitError(f"git show {commit[:12]}:{path} failed: {result.stderr.decode(errors='replace').strip()[-300:]}")
    return result.stdout


def load_files(plan: dict, repo: pathlib.Path) -> list[dict]:
    out = []
    for item in plan["files"]:
        data = read_file_at(repo, item["commit"], item["path"])
        actual = kc.sha256_bytes(data)
        if actual != item["sha256"]:
            raise kc.KitError(f"{item['version']}: file SHA-256 is {actual}, plan says {item['sha256']}")
        text = data.decode("utf-8")
        body = sqllex.prepare_migration(text, self_wrapped=item["selfWrapped"], label=item["version"])
        out.append({**item, "text": text, "body": body})
    return out


def load_postchecks(plan: dict, plan_dir: pathlib.Path) -> tuple[str, list[sqllex.Statement]]:
    name = plan.get("postchecks")
    if not name:
        return "", []
    text = (plan_dir / name).read_text(encoding="utf-8")
    stmts = sqllex.split_statements(text)
    for stmt in stmts:
        if stmt.first not in {"DO", "SELECT"}:
            raise kc.KitError(f"postchecks line {stmt.line}: only DO and SELECT are allowed")
        reason = sqllex.refusal(stmt)
        if reason:
            raise kc.KitError(f"postchecks line {stmt.line}: {reason}")
    return kc.sha256_bytes(text.encode("utf-8")), stmts


def history_array(item: dict) -> str:
    fmt = item["historyStatements"]
    if fmt == "empty":
        return "ARRAY[]::text[]"
    if fmt == "whole-file":
        parts = [item["text"]]
    else:
        parts = [stmt.text.strip() for stmt in item["body"].statements]
    return "ARRAY[" + ", ".join(kc.sql_literal(p) for p in parts) + "]::text[]"


def xid_guard(label: str) -> str:
    return (
        "DO $openplan_xid$ BEGIN IF pg_catalog.pg_current_xact_id()::text IS DISTINCT FROM "
        "(SELECT g.xid FROM pg_temp.openplan_install_guard g) THEN RAISE EXCEPTION "
        f"'openplan install: the transaction changed after {label}'; END IF; END $openplan_xid$;\n"
    )


HISTORY_HASH = (
    "(SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(h.version || ':' || COALESCE(h.name, '') || ':' || "
    "pg_catalog.md5(COALESCE(h.statements::text, '')), E'\\n' ORDER BY h.version COLLATE \"C\"), '')) "
    "FROM supabase_migrations.schema_migrations h)"
)


def render(plan: dict, files: list[dict], postchecks: list[sqllex.Statement], *, kind: str,
           pins: dict | None, plan_sha: str) -> str:
    assert kind in {"dryrun", "install"}
    catalog = kc.catalog_query()
    versions = [f["version"] for f in files]
    count = plan["history"]["count"]
    newest = plan["history"]["newest"]
    lines = [
        f"-- OpenPlan hosted install kit: {'ROLLBACK-ONLY DRY RUN' if kind == 'dryrun' else 'INSTALL'}",
        f"-- window {plan['window']}, capture {plan['capture']}, purpose {plan['purpose']}, plan sha256 {plan_sha}",
        "-- Run only through run_sql.py (psql -X --single-transaction -v ON_ERROR_STOP=1). Never edit by hand.",
        kc.TIMEOUTS.rstrip("\n"),
        "CREATE TEMP TABLE openplan_install_guard ON COMMIT DROP AS SELECT",
        "  pg_catalog.pg_current_xact_id()::text AS xid,",
        "  pg_catalog.current_setting('search_path') AS search_path,",
        "  pg_catalog.clock_timestamp() AS started,",
        f"  {HISTORY_HASH} AS history_hash,",
        "  (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) AS history_count,",
        "  (SELECT pg_catalog.max(version) FROM supabase_migrations.schema_migrations) AS history_newest;",
        "CREATE TEMP TABLE openplan_before (k text PRIMARY KEY, h text NOT NULL, v text NOT NULL) ON COMMIT DROP;",
        "CREATE TEMP TABLE openplan_after (k text PRIMARY KEY, h text NOT NULL, v text NOT NULL) ON COMMIT DROP;",
        "SELECT pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);",
        "INSERT INTO pg_temp.openplan_before SELECT q.k, pg_catalog.md5(q.v), q.v FROM (",
        catalog,
        ") q;",
        "SELECT pg_catalog.set_config('search_path', (SELECT g.search_path FROM pg_temp.openplan_install_guard g), true);",
    ]
    pin_checks = ""
    if kind == "install":
        assert pins is not None
        pin_checks = (
            f"  IF g.history_hash IS DISTINCT FROM {kc.sql_literal(pins['historyTupleHash'])} THEN\n"
            "    RAISE EXCEPTION 'openplan install: migration history changed since the dry run (tuple hash %)', g.history_hash;\n"
            "  END IF;\n"
            "  SELECT pg_catalog.md5(pg_catalog.string_agg(b.k || '=' || b.h, E'\\n' ORDER BY b.k COLLATE \"C\"))\n"
            "    INTO openplan_digest FROM pg_temp.openplan_before b;\n"
            f"  IF openplan_digest IS DISTINCT FROM {kc.sql_literal(pins['beforeDigest'])} THEN\n"
            "    RAISE EXCEPTION 'openplan install: the catalog changed since the dry run (digest %)', openplan_digest;\n"
            "  END IF;\n"
        )
    version_list = ", ".join(kc.sql_literal(v) for v in versions)
    lines.append(
        "DO $openplan_pre$\n"
        "DECLARE g record; openplan_digest text; openplan_present text;\n"
        "BEGIN\n"
        "  SELECT * INTO g FROM pg_temp.openplan_install_guard;\n"
        "  IF session_user <> 'postgres' OR current_user <> 'postgres' THEN\n"
        "    RAISE EXCEPTION 'openplan install: session and current user must both be postgres, found % and %', session_user, current_user;\n"
        "  END IF;\n"
        "  IF (SELECT r.rolsuper FROM pg_catalog.pg_roles r WHERE r.rolname = 'postgres') THEN\n"
        "    RAISE EXCEPTION 'openplan install: postgres is a superuser on this target; hosted postgres is not, so a privilege error could be hidden';\n"
        "  END IF;\n"
        "  IF pg_catalog.current_setting('transaction_read_only') <> 'off' THEN\n"
        "    RAISE EXCEPTION 'openplan install: the transaction is read-only';\n"
        "  END IF;\n"
        "  IF pg_catalog.current_setting('standard_conforming_strings') <> 'on' THEN\n"
        "    RAISE EXCEPTION 'openplan install: standard_conforming_strings must be on';\n"
        "  END IF;\n"
        f"  IF g.history_count <> {count} OR g.history_newest IS DISTINCT FROM {kc.sql_literal(newest)} THEN\n"
        f"    RAISE EXCEPTION 'openplan install: history must read {count} rows through {newest}, found % through %', g.history_count, g.history_newest;\n"
        "  END IF;\n"
        "  SELECT pg_catalog.string_agg(h.version, ', ') INTO openplan_present FROM supabase_migrations.schema_migrations h\n"
        f"    WHERE h.version IN ({version_list});\n"
        "  IF openplan_present IS NOT NULL THEN\n"
        "    RAISE EXCEPTION 'openplan install: planned versions already present: %', openplan_present;\n"
        "  END IF;\n"
        + pin_checks +
        "END $openplan_pre$;"
    )
    for item in files:
        version = item["version"]
        lines.append(f"-- ===== {version}_{item['name']}.sql (sha256 {item['sha256']}"
                     + (", own BEGIN/COMMIT removed" if item["body"].stripped_wrapper else "") + ")")
        for index, stmt in enumerate(item["body"].statements, 1):
            lines.append(stmt.text)
            lines.append(xid_guard(f"{version} statement {index}").rstrip("\n"))
        lines.append(
            "INSERT INTO supabase_migrations.schema_migrations (version, name, statements) VALUES ("
            f"{kc.sql_literal(version)}, {kc.sql_literal(item['name'])}, {history_array({**item, 'historyStatements': plan['historyStatements']})});"
        )
        lines.append(xid_guard(f"{version} history row").rstrip("\n"))
    lines.append("NOTIFY pgrst, 'reload schema';")
    after_count = count + len(files)
    compare = ""
    if kind == "install":
        assert pins is not None
        pinned = json.dumps(pins["delta"], sort_keys=True, separators=(",", ":"))
        tag = kc.dollar_tag("openplan_pins", pinned, catalog)
        compare = (
            "  SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(a.k, b.k), a.h), '{}'::jsonb) INTO openplan_delta\n"
            "    FROM pg_temp.openplan_before b FULL JOIN pg_temp.openplan_after a ON a.k = b.k\n"
            "    WHERE a.h IS DISTINCT FROM b.h;\n"
            f"  openplan_pinned := {tag}{pinned}{tag}::jsonb;\n"
            "  IF openplan_delta IS DISTINCT FROM openplan_pinned THEN\n"
            "    SELECT pg_catalog.string_agg(x.key, ', ' ORDER BY x.key) INTO openplan_bad FROM (\n"
            "      SELECT key FROM pg_catalog.jsonb_each(openplan_delta) d\n"
            "        WHERE NOT (openplan_pinned ? d.key) OR openplan_pinned -> d.key IS DISTINCT FROM d.value\n"
            "      UNION SELECT key FROM pg_catalog.jsonb_each(openplan_pinned) p WHERE NOT (openplan_delta ? p.key)\n"
            "      ORDER BY 1 LIMIT 20) x;\n"
            "    RAISE EXCEPTION 'openplan install: the catalog change differs from the dry run at: %', openplan_bad;\n"
            "  END IF;\n"
        )
    lines.append(
        "DO $openplan_after$\n"
        "DECLARE openplan_saved text := pg_catalog.current_setting('search_path');\n"
        "  openplan_delta jsonb; openplan_pinned jsonb; openplan_bad text; openplan_count bigint; openplan_newest text;\n"
        "BEGIN\n"
        "  PERFORM pg_catalog.set_config('search_path', 'pg_catalog, pg_temp', true);\n"
        "  INSERT INTO pg_temp.openplan_after SELECT q.k, pg_catalog.md5(q.v), q.v FROM (\n"
        + catalog + "\n"
        "  ) q;\n"
        "  PERFORM pg_catalog.set_config('search_path', openplan_saved, true);\n"
        "  SELECT pg_catalog.count(*), pg_catalog.max(version) INTO openplan_count, openplan_newest\n"
        "    FROM supabase_migrations.schema_migrations;\n"
        f"  IF openplan_count <> {after_count} OR openplan_newest IS DISTINCT FROM {kc.sql_literal(versions[-1])} THEN\n"
        f"    RAISE EXCEPTION 'openplan install: history must read {after_count} rows through {versions[-1]}, found % through %', openplan_count, openplan_newest;\n"
        "  END IF;\n"
        + compare +
        "END $openplan_after$;"
    )
    lines.append(xid_guard("the catalog check").rstrip("\n"))
    for index, stmt in enumerate(postchecks, 1):
        lines.append(stmt.text)
        lines.append(xid_guard(f"post-check {index}").rstrip("\n"))
    result = (
        f"SELECT '{kc.RESULT_PREFIX}' || pg_catalog.jsonb_build_object(\n"
        f"  'kind', {kc.sql_literal(kind)}, 'window', {kc.sql_literal(plan['window'])}, 'capture', {kc.sql_literal(plan['capture'])},\n"
        f"  'planSha256', {kc.sql_literal(plan_sha)},\n"
        "  'historyTupleHash', (SELECT g.history_hash FROM pg_temp.openplan_install_guard g),\n"
        "  'historyCountBefore', (SELECT g.history_count FROM pg_temp.openplan_install_guard g),\n"
        "  'beforeDigest', (SELECT pg_catalog.md5(pg_catalog.string_agg(b.k || '=' || b.h, E'\\n' ORDER BY b.k COLLATE \"C\")) FROM pg_temp.openplan_before b),\n"
        "  'afterDigest', (SELECT pg_catalog.md5(pg_catalog.string_agg(a.k || '=' || a.h, E'\\n' ORDER BY a.k COLLATE \"C\")) FROM pg_temp.openplan_after a),\n"
        + ("  'before', (SELECT pg_catalog.jsonb_object_agg(b.k, b.h) FROM pg_temp.openplan_before b),\n" if kind == "dryrun" else "")
        + "  'delta', (SELECT COALESCE(pg_catalog.jsonb_object_agg(COALESCE(a.k, b.k), pg_catalog.jsonb_build_object(\n"
        "      'before', b.h, 'after', a.h, 'value', a.v, 'beforeValue', b.v)), '{}'::jsonb)\n"
        "    FROM pg_temp.openplan_before b FULL JOIN pg_temp.openplan_after a ON a.k = b.k WHERE a.h IS DISTINCT FROM b.h),\n"
        "  'elapsedMs', (SELECT (EXTRACT(EPOCH FROM pg_catalog.clock_timestamp() - g.started) * 1000)::bigint FROM pg_temp.openplan_install_guard g)\n"
        ")::text;"
    )
    lines.append(result)
    if kind == "dryrun":
        lines.append(f"DO $openplan_end$ BEGIN RAISE EXCEPTION '{kc.DRYRUN_SENTINEL}'; END $openplan_end$;")
        lines.append("ROLLBACK;")
    return "\n".join(lines) + "\n"


def bundle_files(plan: dict, files: list[dict], plan_sha: str, post_sha: str) -> list[dict]:
    return [{"version": f["version"], "name": f["name"], "commit": f["commit"], "sha256": f["sha256"],
             "selfWrapped": f["selfWrapped"], "statements": len(f["body"].statements)} for f in files]


def build(args: argparse.Namespace) -> dict:
    plan_path = pathlib.Path(args.plan)
    plan = load_plan(plan_path)
    plan_sha = kc.sha256_file(plan_path)
    files = load_files(plan, pathlib.Path(args.repo))
    post_sha, postchecks = load_postchecks(plan, plan_path.parent)
    out = pathlib.Path(args.out)
    dryrun_text = render(plan, files, postchecks, kind="dryrun", pins=None, plan_sha=plan_sha)
    dryrun_sha = kc.sha256_bytes(dryrun_text.encode("utf-8"))
    if args.mode == "dryrun":
        kc.write_new(out / "DRYRUN.sql", dryrun_text)
        bundle = {"window": plan["window"], "capture": plan["capture"], "purpose": plan["purpose"],
                  "planSha256": plan_sha, "postchecksSha256": post_sha, "dryrunSha256": dryrun_sha,
                  "history": plan["history"], "files": bundle_files(plan, files, plan_sha, post_sha)}
        kc.write_new(out / "bundle.json", json.dumps(bundle, indent=2) + "\n")
        return bundle
    bundle = kc.read_json(out / "bundle.json")
    if bundle.get("dryrunSha256") != dryrun_sha or bundle.get("planSha256") != plan_sha:
        raise kc.KitError("the bundle's dry run was built from a different plan or kit; rebuild the bundle")
    pins = kc.read_json(pathlib.Path(args.pins))
    if pins.get("status") != "dry-run-complete":
        raise kc.KitError("pins must come from a dry run whose status is dry-run-complete")
    if pins.get("sha256") != dryrun_sha:
        raise kc.KitError("the pins come from a different DRYRUN.sql than this plan builds")
    result = pins.get("result") or {}
    for key in ("historyTupleHash", "beforeDigest", "delta", "before"):
        if key not in result:
            raise kc.KitError(f"dry run result is missing {key}")
    if kc.map_digest(result["before"]) != result["beforeDigest"]:
        raise kc.KitError("dry run result is inconsistent: its before map does not give its digest")
    delta = {k: entry.get("after") for k, entry in result["delta"].items()}
    install_text = render(plan, files, postchecks, kind="install",
                          pins={"historyTupleHash": result["historyTupleHash"],
                                "beforeDigest": result["beforeDigest"], "delta": delta},
                          plan_sha=plan_sha)
    kc.write_new(out / "INSTALL.sql", install_text)
    bundle["installSha256"] = kc.sha256_bytes(install_text.encode("utf-8"))
    bundle["pinnedFrom"] = {"target": pins.get("target"), "envelope": pathlib.Path(args.pins).name,
                            "beforeDigest": result["beforeDigest"], "historyTupleHash": result["historyTupleHash"],
                            "deltaKeys": len(delta)}
    (out / "bundle.json").write_text(json.dumps(bundle, indent=2) + "\n", encoding="utf-8")
    return bundle


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("mode", choices=["dryrun", "install"])
    parser.add_argument("--plan", required=True)
    parser.add_argument("--repo", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--pins")
    args = parser.parse_args(argv)
    if args.mode == "install" and not args.pins:
        parser.error("install needs --pins from a completed dry run")
    try:
        bundle = build(args)
    except (kc.KitError, sqllex.SqlRefused) as error:
        print(f"REFUSED: {error}", file=sys.stderr)
        return 2
    print(json.dumps({k: bundle[k] for k in bundle if k.endswith("Sha256") or k in ("window", "capture")}, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
