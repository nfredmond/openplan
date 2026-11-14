"""Tests for the hosted install kit's refusals and guards.

Run from this folder: python -m unittest test_hosted_install -v

The pure tests need only Python and git. The live tests also need a
PostgreSQL 17 database where `postgres` is a non-superuser with CREATEDB, and
run only when OPENPLAN_INSTALL_KIT_PSQL holds a JSON list for the psql command
prefix (for example ["psql"] with PG* set, or ["docker", "exec", "-i", "-u",
"postgres", "<container>", "psql"]). CI sets it in the worker job.

Blind categories: no test reaches hosted Supabase, the session pooler, Railway
or a real capture; the rehearsal in rehearsal/README.md covers a local stack
end to end. The lexer is tested against psql's splitting rules as written in
psqlscan.l, not against every psql version. The credential guard reads this
folder's scripts; it cannot see a command the operator types by hand.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest import mock

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

import build_install  # noqa: E402
import compare_maps  # noqa: E402
import compare_restore  # noqa: E402
import env_to_stdin  # noqa: E402
import health_readback  # noqa: E402
import kitcommon as kc  # noqa: E402
import postverify  # noqa: E402
import run_sql  # noqa: E402
import sqllex  # noqa: E402
import stdin_env  # noqa: E402

KIT = pathlib.Path(__file__).resolve().parent
NOW_OK = dt.datetime(2026, 11, 15, 18, 0, tzinfo=dt.timezone.utc)


# ---------------------------------------------------------------- lexer (B2.1)

class LexerTest(unittest.TestCase):
    def refused(self, sql, wrapped=False):
        with self.assertRaises(sqllex.SqlRefused) as caught:
            sqllex.prepare_migration(sql, self_wrapped=wrapped, label="f")
        return str(caught.exception)

    def test_top_level_end_is_refused(self):
        self.assertIn("transaction control", self.refused("CREATE TABLE a (x int);\nEND;\nCREATE TABLE b (x int);\n"))

    def test_commit_and_chain_is_refused(self):
        self.assertIn("transaction control", self.refused("CREATE TABLE a (x int);\nCOMMIT AND CHAIN;\n"))

    def test_every_transaction_control_form_is_refused(self):
        for stmt in ("BEGIN;", "START TRANSACTION;", "COMMIT;", "ROLLBACK;", "ABORT;", "SAVEPOINT s;",
                     "RELEASE s;", "PREPARE TRANSACTION 'x';", "COMMIT PREPARED 'x';", "ROLLBACK PREPARED 'x';",
                     "end work;", "Commit;"):
            with self.subTest(stmt=stmt):
                self.assertIn("transaction control", self.refused(f"SELECT 1;\n{stmt}\nSELECT 2;\n"))

    def test_end_inside_a_tagged_dollar_body_passes(self):
        sql = ("DO $x$\nBEGIN\n  IF true THEN\n    PERFORM 1;\n  END IF;\nEND;\n$x$;\n"
               "CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$;\n")
        body = sqllex.prepare_migration(sql, self_wrapped=False, label="f")
        self.assertEqual([s.first for s in body.statements], ["DO", "CREATE"])

    def test_quotes_and_comments_never_split_or_hide_statements(self):
        sql = ("SELECT 'a; COMMIT; b', E'it\\'s; END;', \"odd;name\" FROM t; -- COMMIT;\n"
               "/* outer /* COMMIT; */ still comment */ SELECT (1; 2);\n")
        stmts = sqllex.split_statements(sql)
        self.assertEqual(len(stmts), 2)
        self.assertEqual(stmts[1].first, "SELECT")

    def test_psql_meta_command_is_refused(self):
        self.assertIn("meta-command", self.refused("SELECT 1;\n\\i other.sql\n"))
        self.assertIn("meta-command", self.refused("\\set ON_ERROR_STOP 0\nSELECT 1;\n"))

    def test_session_and_timeout_changes_are_refused(self):
        for stmt in ("SET LOCAL statement_timeout = 0;", 'SET "lock_timeout" = 0;', "SET ROLE anon;",
                     "SET LOCAL ROLE service_role;", "RESET ALL;", "SET SESSION AUTHORIZATION x;",
                     "SET search_path = '';", "SET TRANSACTION READ WRITE;", "RESET transaction_timeout;"):
            with self.subTest(stmt=stmt):
                self.refused(f"SELECT 1;\n{stmt}\n")

    def test_statements_that_cannot_run_in_a_transaction_are_refused(self):
        for stmt in ("CREATE INDEX CONCURRENTLY i ON t (x);", "VACUUM t;", "ALTER SYSTEM SET x = 1;",
                     "CREATE DATABASE d;", "DISCARD ALL;", "COPY t FROM STDIN;",
                     "CREATE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;"):
            with self.subTest(stmt=stmt):
                self.refused(stmt + "\n")

    def test_wrapper_is_stripped_only_when_the_plan_says_so(self):
        sql = "-- note\nBEGIN;\nCREATE TABLE a (x int);\nDO $m$ BEGIN PERFORM 1; END $m$;\nCOMMIT;\n"
        body = sqllex.prepare_migration(sql, self_wrapped=True, label="f")
        self.assertTrue(body.stripped_wrapper)
        self.assertEqual([s.first for s in body.statements], ["CREATE", "DO"])
        self.assertIn("selfWrapped=False", self.refused(sql, wrapped=False))
        self.assertIn("selfWrapped=True", self.refused("CREATE TABLE a (x int);\n", wrapped=True))

    def test_a_second_commit_inside_a_wrapped_file_is_refused(self):
        self.refused("BEGIN;\nCREATE TABLE a (x int);\nCOMMIT;\nCREATE TABLE b (x int);\nCOMMIT;\n", wrapped=True)

    def test_unterminated_quotes_are_refused(self):
        for sql in ("SELECT 'x;", "SELECT $a$ x;", "/* x", 'SELECT "x;'):
            with self.subTest(sql=sql):
                with self.assertRaises(sqllex.SqlRefused):
                    sqllex.split_statements(sql)


# ----------------------------------------------------------- read and probe

class ReadAndProbeTest(unittest.TestCase):
    def test_read_mode_refuses_writes(self):
        for sql in ("INSERT INTO t VALUES (1);", "WITH x AS (DELETE FROM t RETURNING 1) SELECT * FROM x;",
                    "DO $$ BEGIN PERFORM 1; END $$;", "SELECT 1 INTO new_table;", "UPDATE t SET x = 1;",
                    "SELECT 1; COMMIT;", "EXPLAIN ANALYZE DELETE FROM t;"):
            with self.subTest(sql=sql):
                with self.assertRaises(sqllex.SqlRefused):
                    sqllex.check_read_only(sql, label="q")

    def test_read_mode_allows_select_with_show(self):
        sqllex.check_read_only("SELECT 1;\nWITH a AS (SELECT 2) SELECT * FROM a;\nSHOW server_version;\n", label="q")

    def test_read_wrapper_opens_a_read_only_transaction_first(self):
        text = run_sql.read_wrapper("SELECT 1;\n")
        self.assertTrue(text.startswith("SET TRANSACTION READ ONLY;\n"))

    def test_probe_must_end_with_rollback(self):
        with self.assertRaisesRegex(sqllex.SqlRefused, "must end with ROLLBACK"):
            sqllex.prepare_probe("UPDATE t SET x = 1;\n", label="p")
        with self.assertRaisesRegex(sqllex.SqlRefused, "transaction control"):
            sqllex.prepare_probe("UPDATE t SET x = 1;\nCOMMIT;\nUPDATE t SET x = 2;\nROLLBACK;\n", label="p")

    def test_probe_wrapper_raises_before_its_rollback(self):
        stmts = sqllex.prepare_probe("SET LOCAL ROLE anon;\nSELECT 1;\nRESET ROLE;\nROLLBACK;\n", label="p")
        text = run_sql.probe_wrapper(stmts)
        self.assertLess(text.index(kc.PROBE_SENTINEL), text.rindex("ROLLBACK;"))
        self.assertTrue(text.startswith(kc.TIMEOUTS))


# ------------------------------------------------------------- the builder

def git(repo: pathlib.Path, *args: str) -> str:
    env = {**os.environ, "GIT_AUTHOR_NAME": "kit", "GIT_AUTHOR_EMAIL": "kit@example.invalid",
           "GIT_COMMITTER_NAME": "kit", "GIT_COMMITTER_EMAIL": "kit@example.invalid"}
    return subprocess.run(["git", "-C", str(repo), *args], check=True, capture_output=True, text=True, env=env).stdout.strip()


MIGRATIONS = {
    "20990101000001_add_note": "-- adds a note column\nALTER TABLE public.kit_items ADD COLUMN note text;\n"
                               "COMMENT ON COLUMN public.kit_items.note IS 'note';\n",
    "20990101000002_wrapped_fn": "BEGIN;\nCREATE FUNCTION public.kit_fn() RETURNS int LANGUAGE plpgsql AS $f$\n"
                                 "BEGIN\n  RETURN 1;\nEND;\n$f$;\nCOMMIT;\n",
}


class Fixture:
    """A git repo holding two migration files, and a plan for them."""

    def __init__(self, root: pathlib.Path, files=MIGRATIONS, history=(1, "20990101000000")):
        self.root = root
        self.repo = root / "repo"
        mig = self.repo / "openplan" / "supabase" / "migrations"
        mig.mkdir(parents=True)
        git(self.repo, "init", "-q")
        for name, text in files.items():
            (mig / f"{name}.sql").write_bytes(text.encode())
        git(self.repo, "add", ".")
        git(self.repo, "commit", "-q", "-m", "fixture")
        self.commit = git(self.repo, "rev-parse", "HEAD")
        entries = []
        for name, text in files.items():
            version, rest = name.split("_", 1)
            entries.append({"version": version, "name": rest,
                            "path": f"openplan/supabase/migrations/{name}.sql", "commit": self.commit,
                            "sha256": kc.sha256_bytes(text.encode()),
                            "selfWrapped": text.startswith("BEGIN;")})
        self.plan = {"window": "test-window", "purpose": "window", "capture": "20991231T000000Z",
                     "history": {"count": history[0], "newest": history[1]},
                     "historyStatements": "whole-file", "files": entries}

    def write_plan(self, name="plan.json", **changes) -> pathlib.Path:
        plan = json.loads(json.dumps(self.plan))
        plan.update(changes)
        path = self.root / name
        path.write_text(json.dumps(plan))
        return path

    def build(self, mode, plan_path, out, pins=None):
        args = mock.Mock(mode=mode, plan=str(plan_path), repo=str(self.repo), out=str(out), pins=pins and str(pins))
        return build_install.build(args)


class BuilderTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.fx = Fixture(pathlib.Path(self.tmp.name))

    def tearDown(self):
        self.tmp.cleanup()

    def test_a_wrong_file_hash_is_refused(self):
        plan = json.loads(json.dumps(self.fx.plan))
        plan["files"][0]["sha256"] = "0" * 64
        path = self.fx.write_plan(files=plan["files"])
        with self.assertRaisesRegex(kc.KitError, "file SHA-256 is"):
            self.fx.build("dryrun", path, self.fx.root / "out")
        self.assertFalse((self.fx.root / "out" / "DRYRUN.sql").exists())

    def test_a_window_reads_every_file_from_one_commit(self):
        plan = json.loads(json.dumps(self.fx.plan))
        plan["files"][1]["commit"] = "1" * 40
        with self.assertRaisesRegex(kc.KitError, "one integration commit"):
            build_install.load_plan(self.fx.write_plan(files=plan["files"]))
        build_install.load_plan(self.fx.write_plan("rehearsal.json", files=plan["files"], purpose="rehearsal"))

    def test_versions_must_rise_above_the_current_history(self):
        with self.assertRaisesRegex(kc.KitError, "versions must rise"):
            build_install.load_plan(self.fx.write_plan(history={"count": 9, "newest": "20990101000001"}))

    def test_every_statement_and_history_row_is_followed_by_the_transaction_guard(self):
        self.fx.build("dryrun", self.fx.write_plan(), self.fx.root / "out")
        text = (self.fx.root / "out" / "DRYRUN.sql").read_text()
        statements = 2 + 1  # the first file's two, the second file's one after its wrapper is removed
        rows = 2
        self.assertEqual(text.count("$openplan_xid$ BEGIN IF"), statements + rows + 1)
        # Read the generated file with the same lexer: the only top-level
        # transaction control is the dry run's final ROLLBACK, after the raise.
        control = [s.words for s in sqllex.split_statements(text) if sqllex.refusal(s) == "transaction control"]
        self.assertEqual(control, [("ROLLBACK",)])
        first_lines = text.split("\n")[3:7]
        self.assertEqual("\n".join(first_lines) + "\n", kc.TIMEOUTS)
        self.assertLess(text.index(kc.DRYRUN_SENTINEL), text.rindex("ROLLBACK;"))

    def test_the_review_timeouts_are_exact(self):
        # Review 15, B5. The builder test above checks that every file opens with
        # these lines; this one pins the values themselves.
        self.assertEqual(kc.TIMEOUTS, "SET LOCAL lock_timeout = '3s';\n"
                                      "SET LOCAL statement_timeout = '60s';\n"
                                      "SET LOCAL idle_in_transaction_session_timeout = '30s';\n"
                                      "SET LOCAL transaction_timeout = '120s';\n")
        self.assertEqual((kc.CAPTURE_QUIET_START, kc.CAPTURE_QUIET_END), ((10, 5), (10, 50)))

    def test_install_needs_pins_from_a_completed_dry_run_of_the_same_plan(self):
        plan_path = self.fx.write_plan()
        bundle = self.fx.build("dryrun", plan_path, self.fx.root / "out")
        pins = self.fx.root / "pins.json"
        good = {"status": "dry-run-complete", "sha256": bundle["dryrunSha256"],
                "result": {"historyTupleHash": "h", "before": {"a": "1"}, "beforeDigest": kc.map_digest({"a": "1"}),
                           "delta": {"b": {"before": None, "after": "2"}}}}
        for broken, message in (({**good, "status": "dry-run-failed"}, "dry-run-complete"),
                                ({**good, "sha256": "f" * 64}, "different DRYRUN.sql"),
                                ({**good, "result": {**good["result"], "beforeDigest": "x"}}, "inconsistent")):
            pins.write_text(json.dumps(broken))
            with self.subTest(message=message):
                with self.assertRaisesRegex(kc.KitError, message):
                    self.fx.build("install", plan_path, self.fx.root / "out", pins)
        pins.write_text(json.dumps(good))
        bundle = self.fx.build("install", plan_path, self.fx.root / "out", pins)
        install = (self.fx.root / "out" / "INSTALL.sql").read_text()
        self.assertEqual(bundle["installSha256"], kc.sha256_bytes(install.encode()))
        self.assertIn('{"b":"2"}', install)
        self.assertNotIn(kc.DRYRUN_SENTINEL, install)

    def test_the_builder_never_overwrites_a_bundle(self):
        plan_path = self.fx.write_plan()
        self.fx.build("dryrun", plan_path, self.fx.root / "out")
        with self.assertRaisesRegex(kc.KitError, "refusing to overwrite"):
            self.fx.build("dryrun", plan_path, self.fx.root / "out")


# --------------------------------------------------------------- the runner

class FakeTarget(run_sql.Target):
    def __init__(self, kind="copy"):
        self.kind = kind

    def describe(self):
        return f"fake-{self.kind}"


def args_for(mode, out, bundle=None, file=None, var=None):
    return mock.Mock(mode=mode, out=str(out), bundle=bundle and str(bundle), file=file and str(file), var=var or [])


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.fx = Fixture(self.root)
        self.plan_path = self.fx.write_plan()
        self.bundle_dir = self.root / "bundle"
        self.bundle = self.fx.build("dryrun", self.plan_path, self.bundle_dir)
        pins = self.root / "pins.json"
        pins.write_text(json.dumps({"status": "dry-run-complete", "sha256": self.bundle["dryrunSha256"],
                                    "result": {"historyTupleHash": "h", "before": {}, "beforeDigest": kc.map_digest({}),
                                               "delta": {}}}))
        self.bundle = self.fx.build("install", self.plan_path, self.bundle_dir, pins)
        self.sent = []

    def tearDown(self):
        self.tmp.cleanup()

    def fake_psql(self, code=0, stdout="", stderr=""):
        def fake(target, sql, variables=None):
            self.sent.append(sql)
            return code, stdout, stderr, 12
        return mock.patch.object(run_sql, "run_psql", side_effect=fake)

    def write_go(self, **changes):
        go = {"capture": self.bundle["capture"], "installSha256": self.bundle["installSha256"], "target": "copy"}
        go.update(changes)
        (self.bundle_dir / "GO.json").write_text(json.dumps(go))

    def install(self, target=None):
        return run_sql.execute(args_for("install", self.root / "ev", self.bundle_dir), target or FakeTarget(), NOW_OK)

    def test_install_refuses_without_a_go_file(self):
        with self.fake_psql(stdout=kc.RESULT_PREFIX + "{}\n"):
            with self.assertRaisesRegex(kc.KitError, "no GO.json"):
                self.install()
        self.assertEqual(self.sent, [])

    def test_install_refuses_a_go_file_for_another_capture_hash_or_target(self):
        for change, message in (({"capture": "20000101T000000Z"}, "different capture"),
                                ({"installSha256": "0" * 64}, "different INSTALL.sql"),
                                ({"target": "hosted"}, "is for target")):
            self.write_go(**change)
            with self.subTest(message=message), self.fake_psql():
                with self.assertRaisesRegex(kc.KitError, message):
                    self.install()
        self.assertEqual(self.sent, [])

    def test_install_is_sent_once_and_never_again_from_the_same_bundle(self):
        self.write_go()
        with self.fake_psql(code=0, stdout=kc.RESULT_PREFIX + '{"kind": "install"}\n'):
            code, envelope = self.install()
        self.assertEqual((code, envelope["status"]), (0, "installed"))
        with self.fake_psql():
            with self.assertRaisesRegex(kc.KitError, "refusing to overwrite"):
                self.install()
        self.assertEqual(len(self.sent), 1)

    def test_a_failed_install_is_reported_and_still_not_resent(self):
        self.write_go()
        with self.fake_psql(code=3, stderr="ERROR: openplan install: the catalog changed"):
            code, envelope = self.install()
        self.assertEqual((code, envelope["status"]), (1, "install-failed"))
        with self.fake_psql(), self.assertRaises(kc.KitError):
            self.install()

    def test_install_refuses_an_edited_install_file(self):
        self.write_go()
        with open(self.bundle_dir / "INSTALL.sql", "a") as handle:
            handle.write("-- edited\n")
        with self.fake_psql(), self.assertRaisesRegex(kc.KitError, "does not match the bundle record"):
            self.install()

    def test_hosted_refuses_a_rehearsal_bundle(self):
        bundle = json.loads((self.bundle_dir / "bundle.json").read_text())
        bundle["purpose"] = "rehearsal"
        (self.bundle_dir / "bundle.json").write_text(json.dumps(bundle))
        with self.fake_psql(), self.assertRaisesRegex(kc.KitError, "rehearsal bundle may not run on hosted"):
            run_sql.execute(args_for("dryrun", self.root / "ev", self.bundle_dir), FakeTarget("hosted"), NOW_OK)

    def test_hosted_writes_stop_around_the_daily_capture(self):
        at_capture = dt.datetime(2026, 11, 15, 10, 17, tzinfo=dt.timezone.utc)
        with self.fake_psql(), self.assertRaisesRegex(kc.KitError, "10:05 and 10:50"):
            run_sql.execute(args_for("dryrun", self.root / "ev", self.bundle_dir), FakeTarget("hosted"), at_capture)
        query = self.root / "q.sql"
        query.write_text("SELECT 1;\n")
        with self.fake_psql():
            code, _ = run_sql.execute(args_for("read", self.root / "ev2", file=query), FakeTarget("hosted"), at_capture)
        self.assertEqual(code, 0)

    def test_dry_run_counts_only_a_raise_with_the_sentinel_as_complete(self):
        result = kc.RESULT_PREFIX + '{"kind": "dryrun"}\n'
        cases = ((3, result, "ERROR:  " + kc.DRYRUN_SENTINEL, "dry-run-complete"),
                 (0, result, "", "dry-run-failed"),
                 (3, result, "ERROR:  relation does not exist", "dry-run-failed"),
                 (3, "", "ERROR:  " + kc.DRYRUN_SENTINEL, "dry-run-failed"))
        for index, (code, out, err, status) in enumerate(cases):
            with self.subTest(status=status, code=code), self.fake_psql(code, out, err):
                _, envelope = run_sql.execute(args_for("dryrun", self.root / f"ev{index}", self.bundle_dir), FakeTarget(), NOW_OK)
                self.assertEqual(envelope["status"], status)

    def test_read_mode_refuses_a_write_before_sending(self):
        query = self.root / "w.sql"
        query.write_text("INSERT INTO public.t VALUES (1);\n")
        with self.fake_psql(), self.assertRaises(sqllex.SqlRefused):
            run_sql.execute(args_for("read", self.root / "ev", file=query), FakeTarget(), NOW_OK)
        self.assertEqual(self.sent, [])

    def test_hosted_target_requires_verified_tls_and_keeps_the_ca_out_of_output(self):
        env = {"PGHOST": "h", "PGUSER": "u", "PGPASSWORD": "synthetic-password", "PGDATABASE": "postgres"}
        with self.assertRaisesRegex(kc.KitError, "verify-full"):
            run_sql.HostedTarget({**env, "PGSSLMODE": "require", "BACKUP_PG_CA_PEM": "x"})
        with self.assertRaisesRegex(kc.KitError, "CA"):
            run_sql.HostedTarget({**env, "PGSSLMODE": "verify-full"})
        target = run_sql.HostedTarget({**env, "PGSSLMODE": "verify-full", "BACKUP_PG_CA_PEM": "synthetic-ca-pem"})
        try:
            self.assertNotIn("BACKUP_PG_CA_PEM", target.environment())
            self.assertEqual(pathlib.Path(target.environment()["PGSSLROOTCERT"]).read_text(), "synthetic-ca-pem")
            self.assertEqual(target.command(), ["psql"])
        finally:
            target.cleanup()

    def test_copy_target_must_be_labeled_and_network_free(self):
        good = {"Config": {"Labels": {run_sql.COPY_LABEL: ""}}, "HostConfig": {"NetworkMode": "none"}}
        run_sql.CopyTarget("c", inspect=lambda name: good)
        with self.assertRaisesRegex(kc.KitError, "label"):
            run_sql.CopyTarget("c", inspect=lambda name: {**good, "Config": {"Labels": {}}})
        with self.assertRaisesRegex(kc.KitError, "network"):
            run_sql.CopyTarget("c", inspect=lambda name: {**good, "HostConfig": {"NetworkMode": "bridge"}})


# ----------------------------------------------------- comparisons and checks

class CompareMapsTest(unittest.TestCase):
    def test_a_changed_value_on_the_right_key_stops_the_window(self):
        result = compare_maps.compare({"fn:f()": "aaa"}, {"fn:f()": "bbb"}, {})
        self.assertFalse(result["pass"])
        self.assertEqual(result["differences"][0]["key"], "fn:f()")

    def test_an_extra_or_missing_key_stops_the_window(self):
        self.assertFalse(compare_maps.compare({"a": "1"}, {"a": "1", "b": "2"}, {})["pass"])
        self.assertFalse(compare_maps.compare({"a": "1", "b": None}, {"a": "1"}, {})["pass"])

    def test_a_written_allowance_passes_only_its_exact_key(self):
        result = compare_maps.compare({"fn:f()": "aaa", "fn:g()": "1"}, {"fn:f()": "bbb", "fn:g()": "1"},
                                      {"fn:f()": "managed default ACL"})
        self.assertTrue(result["pass"])
        self.assertFalse(compare_maps.compare({"fn:f()": "a", "fn:g()": "1"}, {"fn:f()": "b", "fn:g()": "2"},
                                              {"fn:f()": "managed default ACL"})["pass"])

    def test_allowances_need_a_reason_and_an_exact_key(self):
        with tempfile.TemporaryDirectory() as raw:
            path = pathlib.Path(raw) / "allowed.json"
            for bad in ({"allowed": [{"key": "fn:*"}]}, {"allowed": [{"key": "fn:*", "reason": "all"}]}):
                path.write_text(json.dumps(bad))
                with self.assertRaises(kc.KitError):
                    compare_maps.load_allowed(path)


class PostverifyTest(unittest.TestCase):
    def envelopes(self, current):
        dryrun = {"status": "dry-run-complete", "result": {"before": {"a": "1", "b": "2"},
                  "delta": {"b": {"after": "3"}, "c": {"after": "4"}, "a": {"after": None}}}}
        catalog = {"status": "read", "result": {"map": current, "digest": kc.map_digest(current)}}
        return dryrun, catalog

    def test_the_whole_catalog_must_equal_the_before_map_with_the_changes_applied(self):
        self.assertTrue(postverify.check(*self.envelopes({"b": "3", "c": "4"}))["pass"])
        for current in ({"b": "3", "c": "4", "d": "5"}, {"b": "3"}, {"b": "2", "c": "4"}, {"a": "1", "b": "3", "c": "4"}):
            with self.subTest(current=current):
                self.assertFalse(postverify.check(*self.envelopes(current))["pass"])


class CompareRestoreTest(unittest.TestCase):
    STARTED = "2026-11-15T12:00:00+00:00"

    def readback(self, **changes):
        base = {"kind": "restore-readback", "captureStarted": self.STARTED,
                "history": {"count": 448, "newest": "20261024200400", "tupleHash": "h"},
                "tables": {"public.projects": {"count": 3, "recent": 0}, "public.notes": {"count": 9, "recent": 0}},
                "keyHashes": {t: {"pk": "id", "md5": "m"} for t in compare_restore.KEY_TABLES},
                "objects": [["maps", "a.zip", "10", "2026-11-01T00:00:00+00:00", "2026-11-01T00:00:00+00:00"]],
                "buckets": ["maps"], "eventTriggers": [["e", "postgres", "O"]]}
        base.update(changes)
        return base

    MANIFEST = {"capturedAt": STARTED, "objects": [{"bucket": "maps", "path": "a.zip", "bytes": 10}]}
    PROBES = [{"probe": "picked", "project": True, "owner": True, "other": True},
              {"probe": "owner", "rows": 1}, {"probe": "other-workspace", "rows": 0}, {"probe": "anon", "rows": 0}]

    def test_identical_readbacks_pass(self):
        self.assertTrue(compare_restore.compare(self.readback(), self.readback(), self.MANIFEST, self.PROBES)["pass"])

    def test_a_count_difference_passes_only_with_rows_written_after_the_capture_started(self):
        source = self.readback(tables={"public.projects": {"count": 3, "recent": 0}, "public.notes": {"count": 10, "recent": 0}})
        self.assertFalse(compare_restore.compare(self.readback(), source, self.MANIFEST, self.PROBES)["pass"])
        source["tables"]["public.notes"]["recent"] = 1
        result = compare_restore.compare(self.readback(), source, self.MANIFEST, self.PROBES)
        self.assertTrue(result["pass"])
        self.assertEqual(result["explained"][0]["table"], "public.notes")

    def test_a_storage_row_without_its_bytes_stops_unless_written_during_the_run(self):
        manifest = {**self.MANIFEST, "objects": [{"bucket": "maps", "path": "a.zip", "bytes": 11}]}
        self.assertFalse(compare_restore.compare(self.readback(), self.readback(), manifest, self.PROBES)["pass"])
        late = [["maps", "a.zip", "10", "2026-11-15T12:00:05+00:00", "2026-11-15T12:00:05+00:00"]]
        self.assertTrue(compare_restore.compare(self.readback(objects=late), self.readback(objects=late), manifest, self.PROBES)["pass"])
        missing = {**self.MANIFEST, "objects": []}
        self.assertFalse(compare_restore.compare(self.readback(), self.readback(), missing, self.PROBES)["pass"])

    def test_boundary_probes_must_read_one_zero_zero(self):
        leaky = [p if p["probe"] != "anon" else {"probe": "anon", "rows": 1} for p in self.PROBES]
        self.assertFalse(compare_restore.compare(self.readback(), self.readback(), self.MANIFEST, leaky)["pass"])
        self.assertFalse(compare_restore.compare(self.readback(), self.readback(), self.MANIFEST, self.PROBES[1:])["pass"])

    def test_history_must_match_exactly(self):
        source = self.readback(history={"count": 449, "newest": "20261102100000", "tupleHash": "x"})
        self.assertFalse(compare_restore.compare(self.readback(), source, self.MANIFEST, self.PROBES)["pass"])


class HealthReadbackTest(unittest.TestCase):
    def catalog(self, versions):
        current = {f"hist:{v}": "x" for v in versions}
        return {"status": "read", "result": {"map": current, "digest": kc.map_digest(current)}}

    def test_commit_count_and_newest_must_all_match(self):
        applied = health_readback.applied_history(self.catalog(["20261024200400", "20261102140000"]))
        # The shape of the real route, copied from a hosted read on 2026-11-14:
        # commit and migrations sit inside "deployment", not at the top level.
        def health(commit="abcdef123456", expected=2, latest="20261102140000"):
            return {"status": "ok", "service": "openplan", "checkedAt": "2026-11-14T05:31:16.069Z",
                    "deployment": {"commit": commit, "version": "0.72.0",
                                   "migrations": {"expected": expected, "latest": latest}},
                    "checks": {"app": "ok", "database": "not_checked"}}
        self.assertTrue(health_readback.check(health(), "abcdef1234567890", applied)["pass"])
        self.assertFalse(health_readback.check(health(commit="0123456789ab"), "abcdef1234567890", applied)["pass"])
        self.assertFalse(health_readback.check(health(expected=3), "abcdef1234567890", applied)["pass"])
        self.assertFalse(health_readback.check(health(latest="20261024200400"), "abcdef1234567890", applied)["pass"])

    def test_a_response_without_the_deployment_object_is_refused(self):
        applied = health_readback.applied_history(self.catalog(["20261024200400", "20261102140000"]))
        flat = {"status": "ok", "commit": "abcdef123456", "migrations": {"expected": 2, "latest": "20261102140000"}}
        with self.assertRaises(kc.KitError):
            health_readback.check(flat, "abcdef1234567890", applied)
        with self.assertRaises(kc.KitError):
            health_readback.check({"status": "error", "deployment": {}}, "abcdef1234567890", applied)

    def test_the_live_route_shape_is_what_the_check_reads(self):
        # Ties the kit to the app: the route source must still nest these fields.
        route = (pathlib.Path(__file__).resolve().parents[3] / "openplan/src/app/api/health/route.ts").read_text(encoding="utf-8")
        self.assertRegex(route, r"deployment:\s*\{[\s\S]*?commit[\s\S]*?migrations:")


# ------------------------------------------------------- credentials (N1)

class CredentialTest(unittest.TestCase):
    ENV = {"PGHOST": "h", "PGUSER": "u", "PGPASSWORD": "synthetic-pw", "PGDATABASE": "d", "PGSSLMODE": "verify-full",
           "HOME": "/home/x", "SOMETHING_ELSE": "not sent"}

    def test_env_to_stdin_refuses_a_terminal(self):
        class Tty(io.StringIO):
            def isatty(self):
                return True
        out = Tty()
        with self.assertRaises(SystemExit):
            env_to_stdin.main(["pg"], self.ENV, out)
        self.assertEqual(out.getvalue(), "")

    def test_env_to_stdin_sends_only_the_named_set(self):
        out = io.StringIO()
        env_to_stdin.main(["pg"], self.ENV, out)
        sent = json.loads(out.getvalue())
        self.assertEqual(set(sent), {"PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE", "PGSSLMODE"})
        with self.assertRaisesRegex(SystemExit, "PGPASSWORD"):
            env_to_stdin.main(["pg"], {k: v for k, v in self.ENV.items() if k != "PGPASSWORD"}, io.StringIO())

    def test_stdin_env_accepts_only_plain_names_and_string_values(self):
        self.assertEqual(stdin_env.parse('{"PGHOST": "h"}'), {"PGHOST": "h"})
        for bad in ('{"pghost": "h"}', '{"PGPORT": 5432}', "[]", "PGHOST=h", "{}"):
            with self.subTest(bad=bad), self.assertRaises(SystemExit):
                stdin_env.parse(bad)

    @unittest.skipIf(os.name == "nt", "os.execvp replaces the process only on POSIX; the kit runs it in a Linux container")
    def test_stdin_env_hands_the_variables_to_the_command_and_closes_stdin(self):
        payload = json.dumps({"OPENPLAN_KIT_PROBE": "value-from-stdin"}) + "\nsecond line\n"
        code = ("import os, sys; print(os.environ['OPENPLAN_KIT_PROBE']); print(repr(sys.stdin.read()))")
        result = subprocess.run([sys.executable, str(KIT / "stdin_env.py"), sys.executable, "-c", code],
                                input=payload, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.split(), ["value-from-stdin", "''"])

    CREDENTIAL = re.compile(r"\b(PG[A-Z_]+|AWS_[A-Z_]+|SUPABASE_[A-Z_]+|BACKUP_PG_CA_PEM|BACKUP_GPG_[A-Z_]+)\b")

    def kit_sources(self):
        return [p for p in KIT.rglob("*") if p.suffix in {".sh", ".py"} and p.name != pathlib.Path(__file__).name]

    def test_no_kit_script_passes_a_value_to_docker_on_the_command_line(self):
        shell_value = re.compile(r"(?:^|\s)(?:-e|--env)\s+[A-Za-z_][A-Za-z0-9_]*=")
        py_value = re.compile(r"[\"'](?:-e|--env)[\"']\s*,\s*f?[\"'][A-Za-z_][A-Za-z0-9_]*=")
        shell_name = re.compile(r"(?:^|\s)(?:-e|--env)\s+\"?\$?\{?([A-Za-z_][A-Za-z0-9_]*)")
        py_name = re.compile(r"[\"'](?:-e|--env)[\"']\s*,\s*[\"']([A-Za-z_][A-Za-z0-9_]*)[\"']")
        checked = 0
        for path in self.kit_sources():
            text = path.read_text(encoding="utf-8")
            code_lines = [line for line in text.splitlines() if not line.lstrip().startswith("#")]
            code = "\n".join(code_lines)
            with self.subTest(path=path.name):
                self.assertNotRegex(code, r"--env-file")
                self.assertIsNone(shell_value.search(code) if path.suffix == ".sh" else py_value.search(code))
                names = (shell_name if path.suffix == ".sh" else py_name).findall(code)
                for name in names:
                    self.assertIsNone(self.CREDENTIAL.fullmatch(name), f"{path.name} passes {name} to docker by name")
                if path.suffix == ".sh":
                    self.assertNotRegex(code, r"(?m)^\s*set\s+-[a-z]*x")
            checked += 1
        self.assertGreaterEqual(checked, 10)


# ---------------------------------------------------------- key generation

def git_bash() -> str | None:
    if os.name != "nt":
        return shutil.which("bash")
    candidate = pathlib.Path(r"C:\Program Files\Git\bin\bash.exe")
    return str(candidate) if candidate.exists() else None


@unittest.skipUnless(git_bash() and shutil.which("gpg"), "bash or gpg is not installed")
class KeyScriptTest(unittest.TestCase):
    def test_prints_only_the_fingerprint_and_refuses_an_existing_folder(self):
        bash = git_bash()
        with tempfile.TemporaryDirectory(prefix="k") as raw:
            root = pathlib.Path(raw)
            if os.name == "nt":
                posix = subprocess.run([bash, "-c", f'cygpath -u "{root}"'], capture_output=True, text=True, check=True).stdout.strip()
            else:
                posix = str(root)
            target = posix + "/key"
            script = str(KIT / "keys" / "new_capture_key.sh")
            result = subprocess.run([bash, script, target], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            fpr = result.stdout.strip()
            self.assertRegex(fpr, r"^[0-9A-F]{40}$")
            self.assertEqual(result.stdout, fpr + "\n")
            key = root / "key"
            passphrase = (key / "passphrase.txt").read_text()
            self.assertGreaterEqual(len(passphrase), 40)
            self.assertNotIn(passphrase, result.stdout + result.stderr)
            self.assertEqual((key / "FINGERPRINT").read_text().strip(), fpr)
            self.assertIn("BEGIN PGP PRIVATE KEY BLOCK", (key / "secret.asc").read_text())
            self.assertIn("BEGIN PGP PUBLIC KEY BLOCK", (key / "public.asc").read_text())
            self.assertFalse((key / "roundtrip").exists())
            again = subprocess.run([bash, script, target], capture_output=True, text=True)
            self.assertEqual(again.returncode, 2)
            self.assertEqual(again.stdout, "")
            subprocess.run(["gpgconf", "--homedir", str(key / "gnupg"), "--kill", "gpg-agent"], capture_output=True)


# ---------------------------------------------- live PostgreSQL (B2.2, B3)

LIVE = os.environ.get("OPENPLAN_INSTALL_KIT_PSQL")


class CommandTarget(run_sql.Target):
    kind = "copy"

    def __init__(self, prefix, database):
        self.prefix, self.database = prefix, database

    def command(self):
        return self.prefix + ["-d", self.database]

    def describe(self):
        return f"live:{self.database}"


@unittest.skipUnless(LIVE, "set OPENPLAN_INSTALL_KIT_PSQL to run the live PostgreSQL tests")
class LiveInstallTest(unittest.TestCase):
    """Runs the generated SQL on a real PostgreSQL 17 database as postgres."""

    SETUP = ("CREATE SCHEMA supabase_migrations;\n"
             "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);\n"
             "INSERT INTO supabase_migrations.schema_migrations VALUES ('20990101000000', ARRAY['x'], 'base');\n"
             "CREATE TABLE public.kit_items (id int PRIMARY KEY, label text);\n"
             "INSERT INTO public.kit_items VALUES (1, 'one');\n")

    def setUp(self):
        self.prefix = json.loads(LIVE)
        self.database = "kit_live_" + uuid.uuid4().hex[:10]
        self.admin = CommandTarget(self.prefix, "postgres")
        self.sql(self.admin, f"CREATE DATABASE {self.database}", single=False)
        self.target = CommandTarget(self.prefix, self.database)
        self.sql(self.target, self.SETUP)
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.sql(self.admin, f"DROP DATABASE IF EXISTS {self.database} WITH (FORCE)", single=False)
        self.tmp.cleanup()

    def sql(self, target, text, single=True):
        command = target.command() + ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"]
        command += ["--single-transaction", "-f", "-"] if single else ["-c", text]
        result = subprocess.run(command, input=text.encode() if single else None, capture_output=True)
        if result.returncode != 0:
            raise AssertionError(result.stderr.decode(errors="replace"))
        return result.stdout.decode().strip()

    def history(self):
        return self.sql(self.target, "SELECT count(*) || ' ' || max(version) FROM supabase_migrations.schema_migrations")

    def dry_run(self, fixture, plan_path, out):
        bundle = fixture.build("dryrun", plan_path, out)
        code, stdout, stderr, elapsed = run_sql.run_psql(self.target, (out / "DRYRUN.sql").read_text())
        self.assertEqual(code, 3, stderr)
        self.assertIn(kc.DRYRUN_SENTINEL, stderr)
        result = kc.parse_results(stdout)[0]
        envelope = {"status": "dry-run-complete", "sha256": bundle["dryrunSha256"], "target": "live", "result": result}
        pins = out.parent / f"{out.name}-pins.json"
        pins.write_text(json.dumps(envelope))
        return envelope, pins

    def make(self, files=MIGRATIONS):
        fixture = Fixture(self.root / uuid.uuid4().hex[:6], files=files)
        return fixture, fixture.write_plan()

    def test_dry_run_rolls_back_and_records_the_new_column_by_value(self):
        fixture, plan = self.make()
        envelope, _ = self.dry_run(fixture, plan, fixture.root / "b")
        self.assertEqual(self.history(), "1 20990101000000")
        delta = envelope["result"]["delta"]
        self.assertIn("col:public.kit_items.note", delta)
        self.assertIn('"text"', delta["col:public.kit_items.note"]["value"])
        self.assertIn("fn:public.kit_fn()", delta)
        self.assertIn("hist:20990101000002", delta)
        self.assertEqual(kc.map_digest(envelope["result"]["before"]), envelope["result"]["beforeDigest"])

    def test_install_pinned_from_the_dry_run_applies_once(self):
        fixture, plan = self.make()
        envelope, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        code, stdout, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text())
        self.assertEqual(code, 0, stderr)
        self.assertEqual(self.history(), "3 20990101000002")
        catalog = run_sql.run_psql(self.target, run_sql.read_wrapper(kc.catalog_map_select()))
        current = kc.parse_results(catalog[1])[0]
        check = postverify.check(envelope, {"status": "read", "result": current})
        self.assertTrue(check["pass"], check)

    def test_install_refuses_a_change_whose_value_differs_from_the_dry_run(self):
        fixture, plan = self.make()
        envelope, pins = self.dry_run(fixture, plan, fixture.root / "b")
        envelope["result"]["delta"]["col:public.kit_items.note"]["after"] = "0" * 32
        pins.write_text(json.dumps(envelope))
        fixture.build("install", plan, fixture.root / "b", pins)
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text())
        self.assertEqual(code, 3)
        self.assertIn("differs from the dry run at: col:public.kit_items.note", stderr)
        self.assertEqual(self.history(), "1 20990101000000")

    def test_install_refuses_catalog_drift_after_the_dry_run(self):
        fixture, plan = self.make()
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        self.sql(self.target, "CREATE TABLE public.kit_unrelated (x int);")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text())
        self.assertEqual(code, 3)
        self.assertIn("the catalog changed since the dry run", stderr)
        self.assertEqual(self.history(), "1 20990101000000")

    def test_install_refuses_history_drift_after_the_dry_run(self):
        fixture, plan = self.make()
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        self.sql(self.target, "UPDATE supabase_migrations.schema_migrations SET statements = ARRAY['y'];")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text())
        self.assertEqual(code, 3)
        self.assertIn("migration history changed since the dry run", stderr)

    def test_a_stray_commit_stops_the_run_at_the_next_statement(self):
        # The lexer refuses this file; the transaction guard is the second layer,
        # so the lexer is bypassed here to prove the guard alone.
        files = {"20990101000001_stray": "CREATE TABLE public.kit_before (x int);\nCOMMIT;\n"
                                         "CREATE TABLE public.kit_after_commit (x int);\n",
                 "20990101000002_later": "CREATE TABLE public.kit_later (x int);\n"}
        fixture, plan = self.make(files)
        real = sqllex.prepare_migration

        def lenient(sql, *, self_wrapped, label):
            return sqllex.PreparedBody(statements=tuple(sqllex.split_statements(sql)), stripped_wrapper=False)

        with mock.patch.object(sqllex, "prepare_migration", side_effect=lenient):
            fixture.build("dryrun", plan, fixture.root / "b")
        self.assertIs(sqllex.prepare_migration, real)
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "DRYRUN.sql").read_text())
        self.assertEqual(code, 3)
        self.assertNotIn(kc.DRYRUN_SENTINEL, stderr)
        tables = self.sql(self.target, "SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relname LIKE 'kit\\_%' AND relkind = 'r'")
        # The inner COMMIT kept what came before it; the guard stopped everything after it.
        self.assertEqual(tables, "kit_before,kit_items")
        self.assertEqual(self.history(), "1 20990101000000")

    def test_read_mode_is_read_only_in_the_database_too(self):
        code, _, stderr, _ = run_sql.run_psql(
            self.target, run_sql.read_wrapper("WITH x AS (INSERT INTO public.kit_items VALUES (2, 'two') RETURNING 1) SELECT * FROM x;\n"))
        self.assertEqual(code, 3)
        self.assertIn("read-only transaction", stderr)
        self.assertEqual(self.sql(self.target, "SELECT count(*) FROM public.kit_items"), "1")


if __name__ == "__main__":
    unittest.main()
