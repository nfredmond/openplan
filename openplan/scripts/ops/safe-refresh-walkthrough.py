#!/usr/bin/env python3
"""Prepare a demo separately, retain its predecessor and recover failed updates.

Use this entry point for operator updates. The shell builder's prepare-only mode
checks its local migration inventory; it does not prove the runtime database.
Pending local migrations get a retained backup before application. No reset runs.
Retained directories contain secrets
and stay local, inside a mode-0700 sibling directory.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid


class UpdateError(RuntimeError):
    pass


def command(args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=30)
    if result.returncode:
        # Avoid echoing service command lines or configuration values.
        raise UpdateError(f"{args[0]} failed with exit {result.returncode}")
    return result.stdout.strip()


class DemoUpdate:
    def __init__(self, instance: Path, service: str, url: str) -> None:
        self.instance = instance.absolute()
        if self.instance.is_symlink():
            raise UpdateError("The instance root must be a directory, not a symlink")
        self.service = service
        self.url = url.rstrip("/")
        self.state = self.instance.parent / f".{self.instance.name}-updates"
        self.state.mkdir(mode=0o700, exist_ok=True)
        self.receipt = self.state / "latest.json"

    def check_target(self) -> None:
        configured = command(["systemctl", "--user", "show", self.service, "--property=WorkingDirectory", "--value"])
        if Path(configured).absolute() != self.instance / "openplan":
            raise UpdateError("Service working directory does not match the selected instance")
        print(f"Target: {self.service}, {self.instance}, {self.url}", flush=True)

    def save(self, record: dict) -> None:
        temporary = self.state / "latest.tmp"
        with temporary.open("w") as stream:
            json.dump(record, stream, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.receipt)
        fd = os.open(self.state, os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def health_matches(self, sha: str) -> bool:
        try:
            with urllib.request.urlopen(self.url + "/api/health", timeout=2) as response:
                raw = json.load(response)
            commit = raw.get("deployment", {}).get("commit")
            return isinstance(commit, str) and len(commit) >= 12 and sha.startswith(commit)
        except (OSError, ValueError, AttributeError, urllib.error.URLError):
            return False

    def restart(self, sha: str) -> None:
        command(["systemctl", "--user", "restart", self.service])
        for _ in range(30):
            if self.health_matches(sha):
                return
            time.sleep(1)
        raise UpdateError("Restarted service did not report the expected commit")

    def source_path(self, root: Path, relative: str) -> Path:
        path = root / relative
        if Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise UpdateError("Source path escapes the selected directory")
        parent = path.parent
        while parent != root:
            if parent.is_symlink() or (parent.exists() and not parent.is_dir()):
                raise UpdateError("A source path has a symlink or non-directory ancestor")
            parent = parent.parent
        return path

    def fingerprint(self, path: Path) -> str | None:
        if path.is_symlink():
            return "link:" + os.readlink(path)
        if not path.exists():
            return None
        if not path.is_file():
            raise UpdateError("A tracked file conflicts with an existing directory")
        return f"{path.stat().st_mode & 0o777}:" + hashlib.sha256(path.read_bytes()).hexdigest()

    def copy_file(self, source: Path, target: Path) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.parent / (".openplan-copy-" + uuid.uuid4().hex)
        if source.is_symlink():
            temporary.symlink_to(os.readlink(source))
        else:
            shutil.copy2(source, temporary)
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
        os.replace(temporary, target)

    def snapshot(self, record: dict) -> None:
        candidate = Path(record["candidate"])
        backup = Path(record["backup"])
        previous = record["previous_sha"]
        updated = record["candidate_sha"]
        # Fetch objects without changing the active source, branch or index.
        command(["git", "fetch", "--quiet", str(candidate), updated], self.instance)
        paths = command(["git", "diff", "--name-only", "--no-renames", "-z", previous, updated], self.instance).split("\0")
        old_paths = set(command(["git", "ls-tree", "-r", "--name-only", "-z", previous], self.instance).split("\0"))
        record["files"] = []
        for relative in [*filter(None, paths), "openplan/.env.local"]:
            current = self.source_path(self.instance, relative)
            incoming = self.source_path(candidate, relative)
            before = self.fingerprint(current)
            if relative != "openplan/.env.local" and relative not in old_paths and before is not None:
                raise UpdateError("New source would overwrite an existing local file")
            record["files"].append({"path": relative, "before": before, "after": self.fingerprint(incoming)})
        command(["git", "clone", "--quiet", "--no-checkout", str(self.instance), str(backup)])
        for entry in record["files"]:
            if entry["before"] is not None:
                self.copy_file(self.instance / entry["path"], backup / entry["path"])
        record["runtime"] = []
        for relative in ("openplan/.next", "openplan/node_modules"):
            current = self.instance / relative
            incoming = candidate / relative
            if current.is_symlink() or incoming.is_symlink():
                raise UpdateError("Runtime directories must not be symlinks")
            if not incoming.is_dir():
                raise UpdateError("Prepared build is missing a runtime directory")
            record["runtime"].append({"path": relative, "existed": current.exists()})
        self.save(record)

    def install(self, record: dict) -> None:
        candidate = Path(record["candidate"])
        backup = Path(record["backup"])
        command(["systemctl", "--user", "stop", self.service])
        for entry in record["files"]:
            current = self.source_path(self.instance, entry["path"])
            if self.fingerprint(current) != entry["before"]:
                raise UpdateError("Source or settings changed during promotion")
            if entry["after"] is None:
                current.unlink()
            else:
                self.copy_file(candidate / entry["path"], current)
        for entry in record["runtime"]:
            current = self.instance / entry["path"]
            retained = backup / entry["path"]
            retained.parent.mkdir(parents=True, exist_ok=True)
            if entry["existed"]:
                current.rename(retained)
            (candidate / entry["path"]).rename(current)
        # Metadata follows fully installed files; read-tree does not touch files.
        command(["git", "update-ref", "HEAD", record["candidate_sha"], record["previous_sha"]], self.instance)
        command(["git", "read-tree", record["candidate_sha"]], self.instance)
        self.verify_source(record, "after")
        self.restart(record["candidate_sha"])

    def verify_source(self, record: dict, version: str) -> None:
        for entry in record.get("files", []):
            if self.fingerprint(self.source_path(self.instance, entry["path"])) != entry[version]:
                raise UpdateError("Installed source or settings do not match the retained transaction")
        if command(["git", "status", "--porcelain", "--untracked-files=no"], self.instance):
            raise UpdateError("Installed tracked source differs from its recorded commit")

    def recover(self, record: dict) -> None:
        self.check_target()
        if record["instance"] != str(self.instance) or record["service"] != self.service or record["url"] != self.url:
            raise UpdateError("Recovery record belongs to a different target")
        if record["phase"] in ("preparing", "snapshotting", "preparation_failed", "recovered"):
            if command(["git", "rev-parse", "HEAD"], self.instance) != record["previous_sha"]:
                raise UpdateError("Original source identity changed; automatic recovery refused")
            self.verify_source(record, "before")
            if not self.health_matches(record["previous_sha"]):
                self.restart(record["previous_sha"])
            record["phase"] = "recovered"
            self.save(record)
            print("The original demo is in place and answering.", flush=True)
            return
        backup = Path(record["backup"])
        if backup.parent.parent != self.state or not backup.is_dir() or backup.is_symlink():
            raise UpdateError("No retained predecessor is available for this target")
        if command(["git", "rev-parse", "HEAD"], backup) != record["previous_sha"]:
            raise UpdateError("Retained predecessor identity changed; recovery refused")
        for entry in record["files"]:
            if self.fingerprint(self.source_path(backup, entry["path"])) != entry["before"]:
                raise UpdateError("Retained recovery source or settings changed; recovery refused")
        current_sha = command(["git", "rev-parse", "HEAD"], self.instance)
        if current_sha not in (record["previous_sha"], record["candidate_sha"]):
            raise UpdateError("Active source identity changed; automatic recovery refused")
        for entry in record["files"]:
            current = self.source_path(self.instance, entry["path"])
            if self.fingerprint(current) not in (entry["before"], entry["after"]):
                raise UpdateError("Source or settings changed after preparation; recovery refused")
        displaced = backup.parent / f"displaced-{uuid.uuid4().hex}"
        displaced.mkdir()
        record["phase"] = "recovering"
        self.save(record)
        command(["systemctl", "--user", "stop", self.service])
        for entry in record["files"]:
            current = self.instance / entry["path"]
            retained = backup / entry["path"]
            if entry["before"] is None:
                if current.exists() or current.is_symlink():
                    saved = displaced / entry["path"]
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    current.rename(saved)
            else:
                self.copy_file(retained, current)
        for entry in record["runtime"]:
            current = self.instance / entry["path"]
            retained = backup / entry["path"]
            if retained.exists() or not entry["existed"]:
                if current.exists():
                    saved = displaced / entry["path"]
                    saved.parent.mkdir(parents=True, exist_ok=True)
                    current.rename(saved)
                if retained.exists():
                    retained.rename(current)
        command(["git", "update-ref", "HEAD", record["previous_sha"], current_sha], self.instance)
        command(["git", "read-tree", record["previous_sha"]], self.instance)
        self.verify_source(record, "before")
        self.restart(record["previous_sha"])
        record["phase"] = "recovered"
        self.save(record)
        print("Previous demo restored; local artifacts kept at their original paths.", flush=True)

    def update(self) -> None:
        self.check_target()
        if not (self.instance / ".git").is_dir() or (self.instance / ".git").is_symlink():
            raise UpdateError("The demo must be an independent clone with its own Git directory")
        if command(["git", "status", "--porcelain", "--untracked-files=no"], self.instance):
            raise UpdateError("Instance has uncommitted changes")
        previous = command(["git", "rev-parse", "HEAD"], self.instance)
        settings = self.instance / "openplan/.env.local"
        if settings.is_symlink():
            raise UpdateError("Managed settings symlinks require a separately reviewed update")
        settings_hash = hashlib.sha256(settings.read_bytes()).hexdigest() if settings.exists() else None
        if not self.health_matches(previous):
            raise UpdateError("Current demo identity is unverified; no update attempted")
        if self.receipt.exists():
            prior = json.loads(self.receipt.read_text())
            if prior["phase"] not in ("ready", "recovered", "preparation_failed"):
                raise UpdateError("An interrupted update needs recovery before another update")
        transaction = self.state / uuid.uuid4().hex
        transaction.mkdir(mode=0o700)
        candidate = transaction / "candidate"
        backup = transaction / "previous"
        record = {"instance": str(self.instance), "service": self.service, "url": self.url,
                  "previous_sha": previous, "backup": str(backup), "candidate": str(candidate), "phase": "preparing",
                  "started_at": datetime.now(timezone.utc).isoformat(), "log": str(transaction / "build.log")}
        self.save(record)
        print("Preparing a separate candidate. The current demo stays in place.", flush=True)
        try:
            def ignore(path: str, names: list[str]) -> list[str]:
                return [name for name in names if name in ("node_modules", ".next")] if Path(path) == self.instance / "openplan" else []
            # Preserve Git-tracked links. Dereferencing them dirties the copy
            # and makes the builder refuse its own candidate before fetching.
            shutil.copytree(self.instance, candidate, symlinks=True, ignore=ignore)
            builder = Path(__file__).with_name("refresh-walkthrough-instance.sh")
            print(f"Update log: {record['log']}", flush=True)
            with Path(record["log"]).open("w") as log:
                with subprocess.Popen(
                    ["bash", str(builder), str(candidate)],
                    env={**os.environ, "OPENPLAN_REFRESH_PREPARE_ONLY": "1",
                         "OPENPLAN_REFRESH_DATABASE_BACKUP": str(transaction / "database-before.dump"),
                         "OPENPLAN_REFRESH_ACTIVE_INSTANCE": str(self.instance),
                         "OPENPLAN_REFRESH_SERVICE": self.service},
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                ) as process:
                    for line in process.stdout:
                        log.write(line)
                        log.flush()
                        print(line, end="", flush=True)
                    code = process.wait()
            if code:
                raise UpdateError(f"Candidate preparation failed with exit {code}. See {record['log']}")
            record["candidate_sha"] = command(["git", "rev-parse", "HEAD"], candidate)
        except BaseException as exc:
            record["phase"] = "preparation_failed"
            record["error"] = str(exc)
            self.save(record)
            print("Preparation failed. The original demo directory is unchanged.", flush=True)
            raise
        self.check_target()
        current_settings_hash = hashlib.sha256(settings.read_bytes()).hexdigest() if settings.exists() else None
        if (command(["git", "rev-parse", "HEAD"], self.instance) != previous
                or command(["git", "status", "--porcelain", "--untracked-files=no"], self.instance)
                or current_settings_hash != settings_hash):
            record["phase"] = "preparation_failed"
            self.save(record)
            raise UpdateError("The demo source or settings changed during preparation; promotion refused")
        record["phase"] = "snapshotting"
        self.save(record)
        try:
            self.snapshot(record)
        except BaseException:
            record["phase"] = "preparation_failed"
            self.save(record)
            raise
        # Persist all owned paths before stopping the service or changing files.
        record["phase"] = "promoting"
        self.save(record)
        try:
            self.install(record)
        except BaseException:
            self.recover(record)
            raise
        record["phase"] = "ready"
        self.save(record)
        print("Demo serves the prepared commit. Previous demo retained for recovery.", flush=True)
        print("Application recovery and database backups are retained separately.", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("instance", nargs="?", type=Path, default=Path.home() / "apps/openplan")
    parser.add_argument("--service", default="openplan-web.service")
    parser.add_argument("--url", default="http://localhost:3000")
    parser.add_argument("--recover", action="store_true")
    args = parser.parse_args()
    try:
        updater = DemoUpdate(args.instance, args.service, args.url)
        with (updater.state / "update.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if args.recover:
                updater.recover(json.loads(updater.receipt.read_text()))
            else:
                updater.update()
    except (UpdateError, OSError, ValueError, KeyError) as exc:
        parser.exit(1, f"Update stopped: {exc}\n")


if __name__ == "__main__":
    main()
