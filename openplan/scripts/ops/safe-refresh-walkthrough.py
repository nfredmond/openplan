#!/usr/bin/env python3
"""Prepare a demo separately, retain its predecessor and recover failed updates.

Use this entry point for operator updates. The shell builder's prepare-only mode
checks its local migration inventory; it does not prove the runtime database.
No database migration or reset runs here. Retained directories contain secrets
and stay local, inside a mode-0700 sibling directory.
"""
from __future__ import annotations

import argparse
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

    def recover(self, record: dict) -> None:
        self.check_target()
        if record["instance"] != str(self.instance) or record["service"] != self.service or record["url"] != self.url:
            raise UpdateError("Recovery record belongs to a different target")
        backup = Path(record["backup"])
        if not backup.exists() and self.instance.is_dir():
            if command(["git", "rev-parse", "HEAD"], self.instance) == record["previous_sha"]:
                if not self.health_matches(record["previous_sha"]):
                    self.restart(record["previous_sha"])
                record["phase"] = "recovered"
                self.save(record)
                print("The original demo is already in place and answering.", flush=True)
                return
        if backup.parent.parent != self.state or not backup.is_dir() or backup.is_symlink():
            raise UpdateError("No retained predecessor is available for this target")
        if command(["git", "rev-parse", "HEAD"], backup) != record["previous_sha"]:
            raise UpdateError("Retained predecessor identity changed; recovery refused")
        displaced = backup.parent / f"displaced-{uuid.uuid4().hex}"
        record["phase"] = "recovering"
        self.save(record)
        if self.instance.exists():
            self.instance.rename(displaced)
        backup.rename(self.instance)
        self.restart(record["previous_sha"])
        record["phase"] = "recovered"
        self.save(record)
        print("Previous demo restored and its served commit verified.", flush=True)

    def update(self) -> None:
        self.check_target()
        if not (self.instance / ".git").is_dir() or (self.instance / ".git").is_symlink():
            raise UpdateError("The demo must be an independent clone with its own Git directory")
        if command(["git", "status", "--porcelain", "--untracked-files=no"], self.instance):
            raise UpdateError("Instance has uncommitted changes")
        previous = command(["git", "rev-parse", "HEAD"], self.instance)
        settings = self.instance / "openplan/.env.local"
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
                  "previous_sha": previous, "backup": str(backup), "candidate": str(candidate), "phase": "preparing"}
        self.save(record)
        print("Preparing a separate candidate. The current demo stays in place.", flush=True)
        try:
            def ignore(path: str, names: list[str]) -> list[str]:
                return [name for name in names if name in ("node_modules", ".next")] if Path(path) == self.instance / "openplan" else []
            shutil.copytree(self.instance, candidate, symlinks=False, ignore=ignore)
            builder = Path(__file__).with_name("refresh-walkthrough-instance.sh")
            result = subprocess.run(["bash", str(builder), str(candidate)], env={**os.environ, "OPENPLAN_REFRESH_PREPARE_ONLY": "1"})
            if result.returncode:
                raise UpdateError(f"Candidate preparation failed with exit {result.returncode}")
            record["candidate_sha"] = command(["git", "rev-parse", "HEAD"], candidate)
        except BaseException:
            record["phase"] = "preparation_failed"
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
        # Persist the recovery paths before either directory is moved.
        record["phase"] = "promoting"
        self.save(record)
        try:
            self.instance.rename(backup)
            candidate.rename(self.instance)
            self.restart(record["candidate_sha"])
        except BaseException:
            if backup.exists():
                self.recover(record)
            raise
        record["phase"] = "ready"
        self.save(record)
        print("Demo serves the prepared commit. Previous demo retained for recovery.", flush=True)
        print("Database identity and browser acceptance still require separate evidence.", flush=True)


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
