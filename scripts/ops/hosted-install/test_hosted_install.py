"""Tests for the hosted install kit's refusals and guards.

Run from this folder: python -m unittest test_hosted_install -v

The pure tests need only Python and git. The live tests also need a
PostgreSQL 17 database where `postgres` is a non-superuser with CREATEDB, and
run only when OPENPLAN_INSTALL_KIT_PSQL holds a JSON list for the psql command
prefix (for example ["psql"] with PG* set, or ["docker", "exec", "-i", "-u",
"postgres", "<container>", "psql"]). CI sets it in the worker job. The latency
tests also need OPENPLAN_INSTALL_KIT_TCP, the database's host:port as seen from
this process, and a psql prefix that accepts a later -h and -p: they put a
delaying TCP proxy between psql and the database.

Blind categories: no test reaches hosted Supabase, the session pooler, Railway
or a real capture; the proxy delays only client-to-server bytes, so it does not
model bandwidth, TCP windows or a slow server-to-client path; the rehearsal in rehearsal/README.md covers a local stack
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
import collections
import queue
import re
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
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

    def test_a_character_above_u_ffff_stays_inside_its_identifier(self):
        # Review 31, N1. PostgreSQL reads "k<emoji>$a$" as one identifier, so
        # COMMIT is a top-level statement here, not the inside of a dollar quote.
        sql = ("CREATE TABLE public.k\U0001F600$a$ (x int);\nCOMMIT;\n"
               "CREATE TABLE public.b$a$ (y int);\n")
        stmts = sqllex.split_statements(sql)
        self.assertEqual([s.first for s in stmts], ["CREATE", "COMMIT", "CREATE"])
        self.assertIn("line 2: COMMIT: transaction control", self.refused(sql))
        with tempfile.TemporaryDirectory() as raw:
            fixture = Fixture(pathlib.Path(raw), files={"20990101000001_first": MIGRATIONS["20990101000001_add_note"],
                                                         "20990101000002_astral": sql})
            with self.assertRaisesRegex(sqllex.SqlRefused, "20990101000002: line 2: COMMIT: transaction control"):
                fixture.build("dryrun", fixture.write_plan(), fixture.root / "out")
            self.assertFalse((fixture.root / "out" / "DRYRUN.sql").exists())

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


# ---------------------------------------------------- one message (lane 28)

class OneMessageTest(unittest.TestCase):
    def test_every_top_level_semicolon_but_the_last_is_escaped(self):
        sql = ("SELECT 'a;b';\n-- c;\nDO $x$ BEGIN PERFORM 1; END $x$;\n"
               "SELECT \"q;\" FROM t; /* ; */\nSELECT 2;\n-- trailing\n")
        message = run_sql.transaction_message(sql, commit=True)
        self.assertTrue(message.startswith("BEGIN\\;\n"))
        self.assertTrue(message.endswith("COMMIT;\n"))
        # Six statements: BEGIN, four in the file, COMMIT. Only COMMIT's
        # semicolon ends the message, so psql sends it once.
        self.assertEqual(message.count("\\;"), 5)
        self.assertIn("'a;b'", message)
        self.assertIn("PERFORM 1; END $x$\\;", message)
        self.assertEqual(run_sql.one_message("SELECT 1;\n-- trailing\n"), "SELECT 1;\n")

    def test_a_dry_run_has_no_commit(self):
        message = run_sql.transaction_message("SELECT 1;\nROLLBACK;\n", commit=False)
        self.assertEqual(message, "BEGIN\\;\nSELECT 1\\;\nROLLBACK;\n")

    def test_psql_shows_every_result_and_stops_on_error(self):
        for flag in ("ON_ERROR_STOP=1", "SHOW_ALL_RESULTS=on"):
            self.assertIn(flag, run_sql.PSQL_FLAGS)
        self.assertNotIn("--single-transaction", run_sql.PSQL_FLAGS)

    def test_rtt_reads_one_time_per_probe(self):
        script = run_sql.rtt_script(3)
        self.assertEqual(script.count("SELECT 1;"), 3)
        self.assertIn("SET TRANSACTION READ ONLY;", script)
        stdout = "1\nTime: 25.500 ms\n1\nTime: 24.000 ms\n1\nTime: 26.250 ms\nTime: 0.2 ms\n"
        done = subprocess.CompletedProcess([], 0, stdout.encode(), b"")
        with mock.patch.object(subprocess, "run", return_value=done):
            code, samples, _, _ = run_sql.run_rtt(FakeTarget(), probes=3)
        self.assertEqual((code, samples[:3]), (0, [25.5, 24.0, 26.25]))


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
        bundle = json.loads((self.fx.root / "out" / "bundle.json").read_text())
        self.assertEqual(bundle["statementChecks"], statements + rows + 1)
        self.assertIn(f"IS DISTINCT FROM {statements + rows + 1} THEN RAISE EXCEPTION", text)
        # Read the generated file with the same lexer: the only top-level
        # transaction control is the dry run's final ROLLBACK, after the raise.
        control = [s.words for s in sqllex.split_statements(text) if sqllex.refusal(s) == "transaction control"]
        self.assertEqual(control, [("ROLLBACK",)])
        first_lines = text.split("\n")[3:7]
        self.assertEqual("\n".join(first_lines) + "\n", kc.INSTALL_TIMEOUTS)
        self.assertLess(text.index(kc.DRYRUN_SENTINEL), text.rindex("ROLLBACK;"))

    def test_the_review_timeouts_are_exact(self):
        # Review 15, B5. The builder test above checks that every file opens with
        # these lines; this one pins the values themselves.
        # Review 31, N3: the dry run and install wait at most 1 s for a lock.
        self.assertEqual(kc.INSTALL_TIMEOUTS, "SET LOCAL lock_timeout = '1s';\n"
                                              "SET LOCAL statement_timeout = '60s';\n"
                                              "SET LOCAL idle_in_transaction_session_timeout = '30s';\n"
                                              "SET LOCAL transaction_timeout = '120s';\n")
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

    def command(self):
        return ["psql"]

    def describe(self):
        return f"fake-{self.kind}"


def args_for(mode, out, bundle=None, file=None, var=None, rtt=None, rehearsed=None):
    return mock.Mock(mode=mode, out=str(out), bundle=bundle and str(bundle), file=file and str(file), var=var or [],
                     rtt=rtt and str(rtt), rehearsed=rehearsed and str(rehearsed))


def lock_line(held=40, checks=6):
    return kc.LOCK_PREFIX + json.dumps({"lockHeldMs": held, "statementChecks": checks,
                                        "firstLockAt": "2026-11-15T18:00:00+00", "serverMs": held + 10}) + "\n"


DRY_OK = kc.BEFORE_PREFIX + '{"before": {"a": "1"}}\n' + kc.RESULT_PREFIX + '{"kind": "dryrun"}\n' + lock_line()


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
        self.commits = []

    def tearDown(self):
        self.tmp.cleanup()

    def fake_psql(self, code=0, stdout="", stderr="", elapsed=12):
        def fake(target, sql, variables=None, *, commit):
            self.sent.append(sql)
            self.commits.append(commit)
            return code, stdout, stderr, elapsed
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
        with self.fake_psql(code=0, stdout=kc.RESULT_PREFIX + '{"kind": "install"}\n' + lock_line()):
            code, envelope = self.install()
        self.assertEqual((code, envelope["status"]), (0, "installed"))
        self.assertEqual(self.commits, [True])
        self.assertEqual(envelope["lockHeldMs"], 40)
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

    def test_only_a_database_error_on_a_live_connection_reads_install_failed(self):
        # Review 31, B1. With one message the server runs every statement
        # through COMMIT even after psql is gone, so a lost connection, a killed
        # psql or a FATAL may have committed: the kit must not call it failed.
        cases = ((3, "psql:<stdin>:9: ERROR:  openplan install: the catalog changed", "install-failed"),
                 (2, "psql: error: connection to server was lost", "install-unknown"),
                 (-9, "", "install-unknown"),
                 (3, "FATAL:  terminating connection due to administrator command\n"
                     "ERROR:  openplan install: the catalog changed", "install-unknown"),
                 (3, "ERROR:  x\npsql:<stdin>:9: connection to server was lost", "install-unknown"),
                 (0, "", "install-unknown"))
        for index, (code, stderr, status) in enumerate(cases):
            marker = self.bundle_dir / "install-attempt-copy.json"
            if marker.exists():
                marker.unlink()
            self.write_go()
            with self.subTest(code=code, stderr=stderr[:30]), self.fake_psql(code=code, stderr=stderr):
                exit_code, envelope = run_sql.execute(args_for("install", self.root / f"ev{index}", self.bundle_dir),
                                                      FakeTarget(), NOW_OK)
                self.assertEqual(envelope["status"], status)
                self.assertEqual(exit_code, 1)

    def test_a_dry_run_that_did_not_end_at_a_database_error_reads_unknown(self):
        for index, (code, stderr, status) in enumerate((
                (3, "ERROR:  relation does not exist", "dry-run-failed"),
                (2, "connection to server was lost", "dry-run-unknown"),
                (-9, "", "dry-run-unknown"),
                (3, "FATAL:  terminating connection due to transaction timeout", "dry-run-unknown"))):
            with self.subTest(code=code), self.fake_psql(code, "", stderr):
                _, envelope = run_sql.execute(args_for("dryrun", self.root / f"ev{index}", self.bundle_dir), FakeTarget(), NOW_OK)
                self.assertEqual(envelope["status"], status)

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
        sentinel = "ERROR:  " + kc.DRYRUN_SENTINEL
        cases = ((3, DRY_OK, sentinel, "dry-run-complete"),
                 (0, DRY_OK, "", "dry-run-unknown"),
                 (3, DRY_OK, "ERROR:  relation does not exist", "dry-run-failed"),
                 (3, "", sentinel, "dry-run-failed"),
                 (3, DRY_OK.replace(kc.BEFORE_PREFIX, "x"), sentinel, "dry-run-failed"),
                 (3, DRY_OK.replace(kc.LOCK_PREFIX, "x"), sentinel, "dry-run-failed"))
        for index, (code, out, err, status) in enumerate(cases):
            with self.subTest(status=status, code=code, index=index), self.fake_psql(code, out, err):
                _, envelope = run_sql.execute(args_for("dryrun", self.root / f"ev{index}", self.bundle_dir), FakeTarget(), NOW_OK)
                self.assertEqual(envelope["status"], status)
        self.assertEqual(set(self.commits), {False})

    def test_a_complete_dry_run_carries_the_before_map_and_the_lock_clock(self):
        with self.fake_psql(3, DRY_OK, "ERROR:  " + kc.DRYRUN_SENTINEL):
            code, envelope = run_sql.execute(args_for("dryrun", self.root / "ev", self.bundle_dir), FakeTarget(), NOW_OK)
        self.assertEqual((code, envelope["status"]), (0, "dry-run-complete"))
        self.assertEqual(envelope["result"]["before"], {"a": "1"})
        self.assertEqual(envelope["lock"]["lockHeldMs"], 40)

    def test_dry_run_too_slow_is_judged_on_the_server_lock_clock(self):
        # Lane 28: a long wall time with a short lock passes; a long lock does not.
        sentinel = "ERROR:  " + kc.DRYRUN_SENTINEL
        with self.fake_psql(3, DRY_OK, sentinel, elapsed=9000):
            code, envelope = run_sql.execute(args_for("dryrun", self.root / "ev1", self.bundle_dir), FakeTarget(), NOW_OK)
        self.assertEqual((code, envelope["status"]), (0, "dry-run-complete"))
        slow = DRY_OK.replace(lock_line(), lock_line(held=kc.LOCK_LIMIT_MS + 1))
        with self.fake_psql(3, slow, sentinel, elapsed=100):
            code, envelope = run_sql.execute(args_for("dryrun", self.root / "ev2", self.bundle_dir), FakeTarget(), NOW_OK)
        self.assertEqual((code, envelope["status"]), (1, "dry-run-too-slow"))
        self.assertEqual(kc.LOCK_LIMIT_MS, 2000)

    def write_rtt(self, name="rtt.json", target="fake-hosted", rtt=25.0, at=NOW_OK, status="measured"):
        path = self.root / name
        path.write_text(json.dumps({"mode": "rtt", "status": status, "target": target, "rttMs": rtt,
                                    "startedAt": at.strftime("%Y%m%dT%H%M%SZ")}))
        return path

    def write_rehearsed(self, held=300, sha=None, name="rehearsed.json"):
        path = self.root / name
        path.write_text(json.dumps({"status": "dry-run-complete", "sha256": sha or self.bundle["dryrunSha256"],
                                    "target": "copy:c", "lock": {"lockHeldMs": held}}))
        return path

    def hosted_dryrun(self, ev, **kw):
        return run_sql.execute(args_for("dryrun", self.root / ev, self.bundle_dir, **kw), FakeTarget("hosted"), NOW_OK)

    def test_a_hosted_dry_run_or_install_needs_a_fresh_round_trip_and_a_rehearsed_lock_time(self):
        cases = (({}, "needs --rtt"),
                 ({"rtt": self.write_rtt()}, "needs --rtt"),
                 ({"rtt": self.write_rtt(at=NOW_OK - dt.timedelta(minutes=31), name="old.json"),
                   "rehearsed": self.write_rehearsed()}, "old; measure again"),
                 ({"rtt": self.write_rtt(target="copy:c", name="copy.json"), "rehearsed": self.write_rehearsed()}, "measured to copy:c"),
                 ({"rtt": self.write_rtt(status="rtt-failed", name="failed.json"), "rehearsed": self.write_rehearsed()}, "not a completed"),
                 ({"rtt": self.write_rtt(), "rehearsed": self.write_rehearsed(sha="0" * 64, name="other.json")}, "not a completed dry run"))
        for index, (kw, message) in enumerate(cases):
            with self.subTest(message=message), self.fake_psql(3, DRY_OK, "ERROR:  " + kc.DRYRUN_SENTINEL):
                with self.assertRaisesRegex(kc.KitError, message):
                    self.hosted_dryrun(f"ev{index}", **kw)
        self.assertEqual(self.sent, [])

    def test_the_lock_estimate_refuses_a_slow_window_before_sending_and_prints_either_way(self):
        out = io.StringIO()
        with self.fake_psql(3, DRY_OK, "ERROR:  " + kc.DRYRUN_SENTINEL), contextlib.redirect_stdout(out):
            code, envelope = self.hosted_dryrun("ok", rtt=self.write_rtt(), rehearsed=self.write_rehearsed(held=1900))
        self.assertEqual(code, 0)
        self.assertEqual(envelope["lockEstimate"]["estimateMs"], 1900)
        self.assertEqual(envelope["lockEstimate"]["roundTripsUnderLock"], 0)
        self.assertIn('"lockEstimate"', out.getvalue())
        self.assertEqual(len(self.sent), 1)
        out = io.StringIO()
        with self.fake_psql(), contextlib.redirect_stdout(out):
            with self.assertRaisesRegex(kc.KitError, "over the 2000 ms limit; nothing was sent"):
                self.hosted_dryrun("slow", rtt=self.write_rtt(), rehearsed=self.write_rehearsed(held=2001, name="slow.json"))
        self.assertIn('"estimateMs": 2001', out.getvalue())
        self.assertEqual(len(self.sent), 1)
        refused = json.loads(next((self.root / "slow").glob("dryrun-*.json")).read_text())
        self.assertEqual(refused["status"], "refused-lock-estimate")

    def test_the_estimate_uses_only_a_dry_run_that_completed(self):
        # Review 31, N6. A failed or too-slow dry run of the same file, with a
        # short lock time on record, is still not a rehearsal.
        for index, status in enumerate(("dry-run-failed", "dry-run-too-slow", "dry-run-unknown")):
            rehearsed = self.root / f"rehearsed-{index}.json"
            rehearsed.write_text(json.dumps({"status": status, "sha256": self.bundle["dryrunSha256"],
                                             "target": "copy:c", "lock": {"lockHeldMs": 300}}))
            with self.subTest(status=status), self.fake_psql(3, DRY_OK, "ERROR:  " + kc.DRYRUN_SENTINEL):
                with self.assertRaisesRegex(kc.KitError, "is not a completed dry run of this bundle"):
                    self.hosted_dryrun(f"ev{index}", rtt=self.write_rtt(name=f"rtt-{index}.json"), rehearsed=rehearsed)
        self.assertEqual(self.sent, [])

    def test_an_install_with_a_result_but_no_lock_line_is_not_installed(self):
        # Review 31, N6: the lock line is the last statement before COMMIT, so
        # without it the kit cannot say the transaction reached COMMIT.
        self.write_go()
        with self.fake_psql(code=0, stdout=kc.RESULT_PREFIX + '{"kind": "install"}\n'):
            code, envelope = self.install()
        self.assertEqual((code, envelope["status"]), (1, "install-unknown"))
        self.assertNotIn("lockHeldMs", envelope)

    def test_a_refused_estimate_does_not_use_up_the_install_attempt(self):
        self.write_go(target="hosted")
        args = args_for("install", self.root / "ev", self.bundle_dir, rtt=self.write_rtt(),
                        rehearsed=self.write_rehearsed(held=5000))
        with self.fake_psql(), contextlib.redirect_stdout(io.StringIO()):
            with self.assertRaisesRegex(kc.KitError, "over the"):
                run_sql.execute(args, FakeTarget("hosted"), NOW_OK)
        self.assertFalse((self.bundle_dir / "install-attempt-hosted.json").exists())
        self.assertEqual(self.sent, [])

    def test_read_mode_refuses_a_write_before_sending(self):
        query = self.root / "w.sql"
        query.write_text("INSERT INTO public.t VALUES (1);\n")
        with self.fake_psql(), self.assertRaises(sqllex.SqlRefused):
            run_sql.execute(args_for("read", self.root / "ev", file=query), FakeTarget(), NOW_OK)
        self.assertEqual(self.sent, [])

    def test_hosted_target_requires_verified_tls_and_keeps_the_ca_out_of_output(self):
        env = {"PGHOST": "h", "PGUSER": "u", "PGPASSWORD": "synthetic-password", "PGDATABASE": "postgres",
               "PGPORT": "5432"}
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

    def test_hosted_target_runs_only_through_the_session_pooler_port(self):
        # Review 31, N5. The refusal comes before psql runs and names no value.
        env = {"PGHOST": "synthetic-host", "PGUSER": "synthetic-user", "PGPASSWORD": "synthetic-password",
               "PGDATABASE": "postgres", "PGSSLMODE": "verify-full", "BACKUP_PG_CA_PEM": "synthetic-ca-pem"}
        with mock.patch.object(subprocess, "run") as never:
            for port in ("6543", "5433", "", None):
                case = dict(env) if port is None else {**env, "PGPORT": port}
                with self.subTest(port=port):
                    with self.assertRaisesRegex(kc.KitError, "PGPORT must be 5432, the Supabase session pooler") as caught:
                        run_sql.HostedTarget(case)
                    message = str(caught.exception)
                    for value in ("synthetic", "6543", "5433"):
                        self.assertNotIn(value, message)
            never.assert_not_called()
        target = run_sql.HostedTarget({**env, "PGPORT": "5432"})
        try:
            self.assertEqual(target.environment()["PGPORT"], "5432")
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


class LiveBase(unittest.TestCase):
    """A fresh database per test on a real PostgreSQL 17, used as postgres."""

    SETUP = ("CREATE SCHEMA supabase_migrations;\n"
             "CREATE TABLE supabase_migrations.schema_migrations (version text PRIMARY KEY, statements text[], name text);\n"
             "INSERT INTO supabase_migrations.schema_migrations VALUES ('20990101000000', ARRAY['x'], 'base');\n"
             "CREATE TABLE public.kit_items (id int PRIMARY KEY, label text);\n"
             "INSERT INTO public.kit_items VALUES (1, 'one');\n"
             "CREATE SEQUENCE public.kit_seq;\n")

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

    def dry_run(self, fixture, plan_path, out, target=None):
        bundle = fixture.build("dryrun", plan_path, out)
        code, stdout, stderr, elapsed = run_sql.run_psql(target or self.target, (out / "DRYRUN.sql").read_text(), commit=False)
        self.assertEqual(code, 3, stderr)
        self.assertIn(kc.DRYRUN_SENTINEL, stderr)
        result = kc.parse_results(stdout)[0]
        result["before"] = kc.parse_results(stdout, kc.BEFORE_PREFIX)[0]["before"]
        lock = kc.parse_results(stdout, kc.LOCK_PREFIX)[0]
        envelope = {"status": "dry-run-complete", "sha256": bundle["dryrunSha256"], "target": "live",
                    "result": result, "lock": lock, "elapsedMs": elapsed}
        pins = out.parent / f"{out.name}-pins.json"
        pins.write_text(json.dumps(envelope))
        return envelope, pins

    def make(self, files=MIGRATIONS):
        fixture = Fixture(self.root / uuid.uuid4().hex[:6], files=files)
        return fixture, fixture.write_plan()


# Runs a command with this process's stdin and kills it, as a dropped network
# would end psql, once the file named first exists. Exit 137 then, as a shell
# reports a killed process.
KILL_ON_FLAG = (
    "import os, subprocess, sys, time\n"
    "flag, data = sys.argv[1], sys.stdin.buffer.read()\n"
    "child = subprocess.Popen(sys.argv[2:], stdin=subprocess.PIPE)\n"
    "child.stdin.write(data)\n"
    "child.stdin.close()\n"
    "while child.poll() is None and not os.path.exists(flag):\n"
    "    time.sleep(0.02)\n"
    "if child.poll() is None:\n"
    "    child.kill()\n"
    "    child.wait()\n"
    "    sys.exit(137)\n"
    "sys.exit(child.returncode)\n"
)


@unittest.skipUnless(LIVE, "set OPENPLAN_INSTALL_KIT_PSQL to run the live PostgreSQL tests")
class LiveInstallTest(LiveBase):
    """Runs the generated SQL on a real PostgreSQL 17 database as postgres."""

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
        code, stdout, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(self.history(), "3 20990101000002")
        catalog = run_sql.run_psql(self.target, run_sql.read_wrapper(kc.catalog_map_select()), commit=True)
        current = kc.parse_results(catalog[1])[0]
        check = postverify.check(envelope, {"status": "read", "result": current})
        self.assertTrue(check["pass"], check)

    def test_install_refuses_a_change_whose_value_differs_from_the_dry_run(self):
        fixture, plan = self.make()
        envelope, pins = self.dry_run(fixture, plan, fixture.root / "b")
        envelope["result"]["delta"]["col:public.kit_items.note"]["after"] = "0" * 32
        pins.write_text(json.dumps(envelope))
        fixture.build("install", plan, fixture.root / "b", pins)
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 3)
        self.assertIn("differs from the dry run at: col:public.kit_items.note", stderr)
        self.assertEqual(self.history(), "1 20990101000000")

    def test_install_refuses_catalog_drift_after_the_dry_run(self):
        fixture, plan = self.make()
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        self.sql(self.target, "CREATE TABLE public.kit_unrelated (x int);")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 3)
        self.assertIn("the catalog changed since the dry run", stderr)
        self.assertEqual(self.history(), "1 20990101000000")

    def test_install_refuses_history_drift_after_the_dry_run(self):
        fixture, plan = self.make()
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        self.sql(self.target, "UPDATE supabase_migrations.schema_migrations SET statements = ARRAY['y'];")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 3)
        self.assertIn("migration history changed since the dry run", stderr)

    def test_a_stray_commit_stops_the_run_at_the_next_statement(self):
        # The lexer refuses this file; the transaction guard is the second layer,
        # so the lexer is bypassed here to prove the guard alone. In one message
        # the statements after a stray COMMIT run in a new implicit block that a
        # later error rolls back, so table state alone cannot tell whether they
        # ran. A sequence is not transactional: nextval after the COMMIT would
        # stay advanced. It must not run at all.
        files = {"20990101000001_stray": "CREATE TABLE public.kit_before (x int);\nCOMMIT;\n"
                                         "SELECT pg_catalog.nextval('public.kit_seq');\n"
                                         "CREATE TABLE public.kit_after_commit (x int);\n",
                 "20990101000002_later": "CREATE TABLE public.kit_later (x int);\n"}
        fixture, plan = self.make(files)
        real = sqllex.prepare_migration

        def lenient(sql, *, self_wrapped, label):
            return sqllex.PreparedBody(statements=tuple(sqllex.split_statements(sql)), stripped_wrapper=False)

        with mock.patch.object(sqllex, "prepare_migration", side_effect=lenient):
            fixture.build("dryrun", plan, fixture.root / "b")
        self.assertIs(sqllex.prepare_migration, real)
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "DRYRUN.sql").read_text(), commit=False)
        self.assertEqual(code, 3)
        self.assertNotIn(kc.DRYRUN_SENTINEL, stderr)
        tables = self.sql(self.target, "SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relname LIKE 'kit\\_%' AND relkind = 'r'")
        # The inner COMMIT kept what came before it; the guard stopped everything after it.
        self.assertEqual(tables, "kit_before,kit_items")
        self.assertEqual(self.sql(self.target, "SELECT is_called FROM public.kit_seq"), "f")
        self.assertEqual(self.history(), "1 20990101000000")

    def test_a_lost_connection_after_sending_reads_unknown_and_the_server_commits(self):
        # Review 31, B1: psql is killed once the server is running the one
        # message. The server finishes it, COMMIT included, after the client is
        # gone, so the envelope must not say the install failed.
        files = {"20990101000001_slow": "ALTER TABLE public.kit_items ADD COLUMN note text;\n"
                                        "SELECT pg_catalog.pg_sleep(1.5);\n"}
        fixture, plan = self.make(files)
        bundle_dir = fixture.root / "b"
        _, pins = self.dry_run(fixture, plan, bundle_dir)
        bundle = fixture.build("install", plan, bundle_dir, pins)
        (bundle_dir / "GO.json").write_text(json.dumps({"capture": bundle["capture"],
                                                        "installSha256": bundle["installSha256"], "target": "copy"}))
        flag = self.root / "kill-now"
        killed = CommandTarget([sys.executable, "-c", KILL_ON_FLAG, str(flag)] + self.prefix, self.database)
        done: dict = {}

        def install():
            with contextlib.redirect_stdout(io.StringIO()):
                done["result"] = run_sql.execute(args_for("install", self.root / "ev", bundle_dir), killed, NOW_OK)

        worker = threading.Thread(target=install)
        worker.start()
        try:
            sleeping = "0"
            for _ in range(200):
                sleeping = self.sql(self.admin, "SELECT count(*) FROM pg_stat_activity WHERE datname = "
                                                f"'{self.database}' AND wait_event = 'PgSleep'")
                if sleeping == "1":
                    break
                time.sleep(0.05)
            self.assertEqual(sleeping, "1", "the install never reached the server")
        finally:
            flag.write_text("")
            worker.join(30)
        code, envelope = done["result"]
        self.assertEqual((code, envelope["status"]), (1, "install-unknown"))
        self.assertNotIn(envelope["exitCode"], (0, 3))
        for _ in range(100):
            if self.history() == "2 20990101000001":
                break
            time.sleep(0.1)
        self.assertEqual(self.history(), "2 20990101000001")
        self.assertEqual(self.sql(self.target, "SELECT count(*) FROM pg_attribute WHERE attrelid = "
                                               "'public.kit_items'::regclass AND attname = 'note'"), "1")

    def test_read_mode_is_read_only_in_the_database_too(self):
        code, _, stderr, _ = run_sql.run_psql(
            self.target, run_sql.read_wrapper("WITH x AS (INSERT INTO public.kit_items VALUES (2, 'two') RETURNING 1) SELECT * FROM x;\n"),
            commit=True)
        self.assertEqual(code, 3)
        self.assertIn("read-only transaction", stderr)
        self.assertEqual(self.sql(self.target, "SELECT count(*) FROM public.kit_items"), "1")

    # ------------------------------------------- one message (lane 28)

    def test_the_review_timeouts_hold_inside_the_one_message(self):
        query = ("SELECT 'S ' || current_setting('lock_timeout') || ',' || current_setting('statement_timeout') || ',' || "
                 "current_setting('idle_in_transaction_session_timeout') || ',' || current_setting('transaction_timeout') "
                 "|| ',' || current_setting('transaction_read_only');\n")
        code, stdout, stderr, _ = run_sql.run_psql(self.target, run_sql.read_wrapper(query), commit=True)
        self.assertEqual(code, 0, stderr)
        self.assertIn("S 3s,1min,30s,2min,on", stdout)
        self.assertNotIn("WARNING", stderr)

    def test_a_held_lock_stops_the_dry_run_at_the_lock_timeout(self):
        fixture, plan = self.make()
        fixture.build("dryrun", plan, fixture.root / "b")
        blocker = subprocess.Popen(self.target.command() + ["-X", "-q", "-c",
                                   "BEGIN; LOCK TABLE public.kit_items IN ACCESS SHARE MODE; SELECT pg_sleep(12); COMMIT;"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                held = self.sql(self.target, "SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid = l.relation "
                                             "WHERE c.relname = 'kit_items' AND l.pid <> pg_backend_pid() AND l.granted")
                if held == "1":
                    break
                time.sleep(0.1)
            self.assertEqual(held, "1", "the blocking session never took its lock")
            code, _, stderr, elapsed = run_sql.run_psql(self.target, (fixture.root / "b" / "DRYRUN.sql").read_text(), commit=False)
        finally:
            blocker.kill()
            blocker.wait()
        self.assertEqual(code, 3)
        self.assertIn("lock timeout", stderr)
        # Review 31, N3: the wait ends at 1 s. The whole run, connection
        # included, stays under 2.5 s; a 3 s lock timeout cannot.
        self.assertGreaterEqual(elapsed, 1000)
        self.assertLess(elapsed, 2500)
        self.assertEqual(self.history(), "1 20990101000000")

    def test_the_lock_clock_starts_at_the_first_exclusive_lock(self):
        files = {"20990101000001_sleep_lock_sleep": "SELECT pg_catalog.pg_sleep(0.6);\n"
                                                    "ALTER TABLE public.kit_items ADD COLUMN note text;\n"
                                                    "SELECT pg_catalog.pg_sleep(0.4);\n"}
        fixture, plan = self.make(files)
        envelope, _ = self.dry_run(fixture, plan, fixture.root / "b")
        lock = envelope["lock"]
        self.assertIsNotNone(lock["firstLockAt"])
        # The 0.6 s before the ALTER is outside the lock; the 0.4 s after it is inside.
        self.assertGreaterEqual(lock["lockHeldMs"], 400)
        self.assertLess(lock["lockHeldMs"], 900)
        self.assertGreaterEqual(lock["serverMs"], 1000)
        self.assertEqual(lock["statementChecks"], 3 + 1 + 1)

    def test_a_bundle_split_differently_from_the_build_never_commits(self):
        fixture, plan = self.make()
        real = build_install.statement_checks
        with mock.patch.object(build_install, "statement_checks", side_effect=lambda f, p: real(f, p) + 1):
            fixture.build("dryrun", plan, fixture.root / "b")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "DRYRUN.sql").read_text(), commit=False)
        self.assertEqual(code, 3)
        self.assertIn("statement checks ran", stderr)
        self.assertNotIn(kc.DRYRUN_SENTINEL, stderr)

    def test_a_bundle_sent_as_two_messages_stops_before_it_commits(self):
        # Review 31, N4. Every statement of one Query message sees the same
        # statement_timestamp() (protocol 53.2.2.1). Here the install's message
        # is cut in two after file 1's last statement check, as a psql, pooler
        # or lexer split would cut it: the first guard of the second message
        # must refuse, and nothing may commit.
        fixture, plan = self.make()
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        message = run_sql.transaction_message((fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        cut = message.rindex("\\;", 0, message.index("INSERT INTO supabase_migrations.schema_migrations"))
        two = message[:cut] + ";" + message[cut + 2:]
        command = self.target.command() + run_sql.PSQL_FLAGS + ["-f", "-"]
        result = subprocess.run(command, input=two.encode(), capture_output=True)
        stderr = result.stderr.decode(errors="replace")
        self.assertEqual(result.returncode, 3, stderr)
        self.assertIn("reached the server in more than one message (found at 20990101000001 history row)", stderr)
        self.assertEqual(self.history(), "1 20990101000000")
        self.assertEqual(self.sql(self.target, "SELECT count(*) FROM pg_attribute WHERE attrelid = "
                                               "'public.kit_items'::regclass AND attname = 'note'"), "0")

    def test_a_failing_post_check_stops_the_install_before_it_commits(self):
        fixture, _ = self.make()
        (fixture.root / "post.sql").write_text(
            "DO $p$ BEGIN IF EXISTS (SELECT 1 FROM public.kit_items WHERE label = 'block') THEN "
            "RAISE EXCEPTION 'openplan post-check says no'; END IF; END $p$;\n")
        plan = fixture.write_plan("post-plan.json", postchecks="post.sql")
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        self.sql(self.target, "INSERT INTO public.kit_items VALUES (2, 'block');")
        code, _, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 3)
        self.assertIn("post-check says no", stderr)
        self.assertEqual(self.history(), "1 20990101000000")
        self.assertEqual(self.sql(self.target, "SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.kit_items'::regclass "
                                               "AND attname = 'note'"), "0")
        self.assertEqual(self.sql(self.target, "SELECT is_called FROM public.kit_seq"), "f")

    def test_an_error_stops_the_message_and_nothing_after_it_runs(self):
        files = {"20990101000001_ok": "ALTER TABLE public.kit_items ADD COLUMN note text;\n",
                 "20990101000002_bad": "ALTER TABLE public.kit_missing ADD COLUMN x int;\n"
                                       "SELECT pg_catalog.nextval('public.kit_seq');\n"}
        fixture, plan = self.make(files)
        fixture.build("dryrun", plan, fixture.root / "b")
        code, stdout, stderr, _ = run_sql.run_psql(self.target, (fixture.root / "b" / "DRYRUN.sql").read_text(), commit=False)
        self.assertEqual(code, 3)
        self.assertIn("kit_missing", stderr)
        self.assertEqual(kc.parse_results(stdout), [])
        self.assertEqual(self.sql(self.target, "SELECT is_called FROM public.kit_seq"), "f")
        self.assertEqual(self.history(), "1 20990101000000")


# ------------------------------------------ latency: a delaying proxy (lane 28)

TCP = os.environ.get("OPENPLAN_INSTALL_KIT_TCP")


class _FrontendCounter:
    """Counts PostgreSQL frontend messages by type in a client-to-server byte stream."""

    STARTUP, SSL, GSS, CANCEL = 196608, 80877103, 80877104, 80877102

    def __init__(self, counts):
        self.counts, self.buf, self.started = counts, b"", False

    def feed(self, data):
        self.buf += data
        while True:
            if not self.started:
                if len(self.buf) < 8:
                    return
                length, code = struct.unpack("!II", self.buf[:8])
                if len(self.buf) < length:
                    return
                self.buf = self.buf[length:]
                if code in (self.SSL, self.GSS):
                    raise AssertionError("the proxy test needs a plain connection (PGSSLMODE=disable)")
                self.started = code == self.STARTUP
            else:
                if len(self.buf) < 5:
                    return
                length = struct.unpack("!I", self.buf[1:5])[0]
                if len(self.buf) < 1 + length:
                    return
                self.counts[self.buf[:1].decode()] += 1
                self.buf = self.buf[1 + length:]


class DelayProxy:
    """A TCP proxy that holds every client-to-server chunk for `delay` seconds
    before passing it on, in order, so each request waits one extra delay; the
    server's replies pass straight through. It counts the client's messages."""

    def __init__(self, upstream: tuple[str, int], delay: float):
        self.upstream, self.delay = upstream, delay
        self.counts: collections.Counter = collections.Counter()
        self.listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen(8)
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def close(self):
        self.listener.close()

    def _accept(self):
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            server = socket.create_connection(self.upstream)
            for s in (client, server):
                s.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            pending: queue.Queue = queue.Queue()
            counter = _FrontendCounter(self.counts)
            threading.Thread(target=self._read_client, args=(client, pending, counter), daemon=True).start()
            threading.Thread(target=self._write_server, args=(server, pending), daemon=True).start()
            threading.Thread(target=self._pipe, args=(server, client), daemon=True).start()

    def _read_client(self, client, pending, counter):
        try:
            while True:
                data = client.recv(65536)
                if not data:
                    break
                counter.feed(data)
                pending.put((time.monotonic() + self.delay, data))
        except OSError:
            pass
        pending.put(None)

    @staticmethod
    def _write_server(server, pending):
        try:
            while True:
                item = pending.get()
                if item is None:
                    server.shutdown(socket.SHUT_WR)
                    return
                due, data = item
                wait = due - time.monotonic()
                if wait > 0:
                    time.sleep(wait)
                server.sendall(data)
        except OSError:
            pass

    @staticmethod
    def _pipe(src, dst):
        try:
            while True:
                data = src.recv(65536)
                if not data:
                    break
                dst.sendall(data)
            dst.shutdown(socket.SHUT_WR)
        except OSError:
            pass


class ProxyTarget(run_sql.Target):
    kind = "copy"

    def __init__(self, prefix, database, port):
        self.prefix, self.database, self.port = prefix, database, port

    def command(self):
        return self.prefix + ["-h", "127.0.0.1", "-p", str(self.port), "-d", self.database]

    def environment(self):
        return {**os.environ, "PGSSLMODE": "disable", "PGGSSENCMODE": "disable"}

    def describe(self):
        return f"proxy:{self.port}"


# Twelve statements that each take an ACCESS EXCLUSIVE lock, so the old path
# holds the lock across about thirty round trips.
MANY = {"20990101000001_many": "".join(f"ALTER TABLE public.kit_items ADD COLUMN c{i} int;\n" for i in range(12))}


@unittest.skipUnless(LIVE and TCP, "set OPENPLAN_INSTALL_KIT_PSQL and OPENPLAN_INSTALL_KIT_TCP to run the latency tests")
class LatencyTest(LiveBase):
    """The lock is held for server time only, whatever the round trip costs."""

    def proxy(self, delay):
        host, port = TCP.rsplit(":", 1)
        proxy = DelayProxy((host, int(port)), delay)
        self.addCleanup(proxy.close)
        return proxy, ProxyTarget(self.prefix, self.database, proxy.port)

    def old_path(self, target, sql):
        """The kit's send before lane 28: psql -1 -f, one statement per round trip.
        Since review 31 (N4) a bundle's first guard refuses a second message, so
        the comparison turns that check off to time the old send at all."""
        sql = sql.replace(build_install.SPLIT_MESSAGE, "false")
        command = target.command() + ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"]
        result = subprocess.run(command, input=sql.encode(), capture_output=True, env=target.environment())
        self.assertEqual(result.returncode, 3, result.stderr.decode(errors="replace"))
        return kc.parse_results(result.stdout.decode(), kc.LOCK_PREFIX)[0]["lockHeldMs"]

    def new_path(self, target, sql):
        code, stdout, stderr, _ = run_sql.run_psql(target, sql, commit=False)
        self.assertEqual(code, 3, stderr)
        self.assertIn(kc.DRYRUN_SENTINEL, stderr)
        return kc.parse_results(stdout, kc.LOCK_PREFIX)[0]["lockHeldMs"]

    def test_old_path_lock_time_grows_with_latency_and_the_new_one_does_not(self):
        fixture, plan = self.make(MANY)
        fixture.build("dryrun", plan, fixture.root / "b")
        sql = (fixture.root / "b" / "DRYRUN.sql").read_text()
        held, queries = {}, {}
        for delay in (0.025, 0.100):
            for name, send in (("old", self.old_path), ("new", self.new_path)):
                proxy, target = self.proxy(delay)
                held[(name, delay)] = send(target, sql)
                queries[(name, delay)] = proxy.counts["Q"]
        print(f"\nlock held (ms): {held}\nquery messages: {queries}", file=sys.stderr)
        # The old path waits a round trip per statement while the lock is held.
        self.assertGreater(held[("old", 0.100)] - held[("old", 0.025)], 20 * 75)
        self.assertGreater(queries[("old", 0.100)], 30)
        # The new path sends one message, so the extra 75 ms per round trip never
        # reaches the lock time.
        self.assertEqual(queries[("new", 0.025)], 1)
        self.assertEqual(queries[("new", 0.100)], 1)
        self.assertLess(held[("new", 0.100)] - held[("new", 0.025)], 75)
        self.assertLess(held[("new", 0.100)], 100)

    def test_the_install_is_one_message_through_the_proxy_too(self):
        fixture, plan = self.make(MANY)
        _, pins = self.dry_run(fixture, plan, fixture.root / "b")
        fixture.build("install", plan, fixture.root / "b", pins)
        proxy, target = self.proxy(0.100)
        code, stdout, stderr, _ = run_sql.run_psql(target, (fixture.root / "b" / "INSTALL.sql").read_text(), commit=True)
        self.assertEqual(code, 0, stderr)
        self.assertEqual(proxy.counts["Q"], 1)
        self.assertLess(kc.parse_results(stdout, kc.LOCK_PREFIX)[0]["lockHeldMs"], 100)
        self.assertEqual(self.history(), "2 20990101000001")

    def test_rtt_measures_the_round_trip(self):
        proxy, target = self.proxy(0.025)
        with tempfile.TemporaryDirectory() as raw, contextlib.redirect_stdout(io.StringIO()):
            code, envelope = run_sql.execute(args_for("rtt", pathlib.Path(raw)), target, NOW_OK)
        self.assertEqual((code, envelope["status"]), (0, "measured"))
        self.assertGreaterEqual(envelope["rttMs"], 24)
        self.assertLess(envelope["rttMs"], 60)
        self.assertEqual(proxy.counts["Q"], 2 + 4 + run_sql.RTT_PROBES + 1)


if __name__ == "__main__":
    unittest.main()
