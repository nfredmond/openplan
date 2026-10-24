"""Encrypted offsite capture of the hosted OpenPlan database and Storage.

Runs once per invocation (a scheduled Railway job). It dumps the managed
database with pg_dump, copies every private Storage object through the
authenticated Storage API with its SHA-256, encrypts the bundle to an OpenPGP
public key whose private half never reaches this host, uploads the ciphertext
to an S3-compatible bucket at a different provider than the database, reads it
back to confirm the stored bytes, and prunes old captures.

The capture is not atomic: writers stay active while the database and the
objects are copied. A restore must reconcile Storage rows against copied bytes.
Plaintext never leaves the container's temporary directory, and no credential
is printed.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Callable, Iterable

CAPTURE_PREFIX = "captures/"
CIPHERTEXT_NAME = "openplan-capture.tar.gpg"
SUMMARY_NAME = "summary.json"


class BackupError(Exception):
    """A failure whose message is safe to log."""


@dataclass(frozen=True)
class Settings:
    supabase_url: str
    service_role_key: str
    bucket: str
    recipient_fingerprint: str
    public_key: str
    retain_days: int
    min_keep: int

    @staticmethod
    def from_env(env: dict[str, str]) -> "Settings":
        missing = [name for name in (
            "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "BACKUP_BUCKET",
            "BACKUP_GPG_FINGERPRINT", "BACKUP_GPG_PUBLIC_KEY",
            "PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE",
        ) if not env.get(name, "").strip()]
        if missing:
            raise BackupError("missing settings: " + ", ".join(sorted(missing)))
        if env.get("PGSSLMODE") != "verify-full":
            raise BackupError("PGSSLMODE must be verify-full")
        if not (env.get("PGSSLROOTCERT", "").strip() or env.get("BACKUP_PG_CA_PEM", "").strip()):
            raise BackupError("provide the database CA as PGSSLROOTCERT or BACKUP_PG_CA_PEM")
        retain_days = int(env.get("BACKUP_RETAIN_DAYS", "30"))
        min_keep = int(env.get("BACKUP_MIN_KEEP", "7"))
        if retain_days < 1 or min_keep < 1:
            raise BackupError("retention settings must be positive")
        return Settings(
            supabase_url=env["SUPABASE_URL"].rstrip("/"),
            service_role_key=env["SUPABASE_SERVICE_ROLE_KEY"].strip(),
            bucket=env["BACKUP_BUCKET"].strip(),
            recipient_fingerprint=env["BACKUP_GPG_FINGERPRINT"].strip().upper(),
            public_key=env["BACKUP_GPG_PUBLIC_KEY"],
            retain_days=retain_days,
            min_keep=min_keep,
        )


def sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def safe_object_path(path: str) -> str:
    """Refuse an object name that could escape the capture directory."""
    parts = path.split("/")
    if not path or path.startswith("/") or any(part in ("", ".", "..") for part in parts):
        raise BackupError("refusing unsafe Storage object path")
    return path


def run(command: list[str], **kwargs) -> subprocess.CompletedProcess:
    result = subprocess.run(command, capture_output=True, text=True, **kwargs)
    if result.returncode != 0:
        # pg_dump and gpg errors name the failing step without credentials.
        raise BackupError(f"{command[0]} failed: {result.stderr.strip()[-400:]}")
    return result


def dump_database(target: pathlib.Path) -> dict:
    run(["pg_dump", "--format=custom", "--no-password", "--file", str(target)])
    listing = run(["pg_restore", "--list", str(target)]).stdout
    entries = [line for line in listing.splitlines() if line and not line.startswith(";")]
    if not entries:
        raise BackupError("database archive index is empty")
    server = next((line.split(":", 1)[1].strip() for line in listing.splitlines()
                   if line.startswith(";     Dumped from database version:")), None)
    return {"bytes": target.stat().st_size, "sha256": sha256_file(target),
            "tocEntries": len(entries), "serverVersion": server}


# Three base64url segments, the first an encoded JSON object ("{" -> "eyJ").
_LEGACY_JWT = re.compile(r"eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")


def service_key_headers(key: str) -> dict[str, str]:
    """A legacy service_role JWT keeps both headers in their original order.

    A Supabase secret key (sb_secret_...) is not a JWT and goes only on apikey.
    This image ships backup.py alone, so the workers' shared helper is not here.
    """
    if _LEGACY_JWT.fullmatch(key):
        return {"Authorization": "Bearer " + key, "apikey": key}
    return {"apikey": key}


class StorageClient:
    def __init__(self, settings: Settings, opener: Callable = urllib.request.urlopen):
        self._base = settings.supabase_url + "/storage/v1"
        self._headers = service_key_headers(settings.service_role_key)
        self._open = opener

    def _request(self, path: str, body: dict | None = None):
        headers = dict(self._headers)
        data = None
        if body is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        request = urllib.request.Request(self._base + path, data=data, headers=headers)
        return self._open(request, timeout=120)

    def buckets(self) -> list[dict]:
        return json.load(self._request("/bucket"))

    def objects(self, bucket: str) -> Iterable[str]:
        pending = [""]
        while pending:
            prefix = pending.pop()
            offset = 0
            while True:
                items = json.load(self._request("/object/list/" + urllib.parse.quote(bucket), {
                    "prefix": prefix, "limit": 1000, "offset": offset,
                    "sortBy": {"column": "name", "order": "asc"},
                }))
                for item in items:
                    path = "/".join(part for part in (prefix, item["name"]) if part)
                    if item.get("id") is None:
                        pending.append(path)
                    else:
                        yield safe_object_path(path)
                if len(items) < 1000:
                    break
                offset += len(items)

    def download(self, bucket: str, path: str, target: pathlib.Path) -> None:
        quoted = urllib.parse.quote(bucket) + "/" + urllib.parse.quote(path, safe="/")
        with self._request("/object/authenticated/" + quoted) as response, target.open("wb") as out:
            shutil.copyfileobj(response, out, 1 << 20)


def copy_storage(client: StorageClient, root: pathlib.Path) -> dict:
    buckets = client.buckets()
    inventory = []
    for bucket in buckets:
        bucket_id = safe_object_path(bucket["id"])
        for path in client.objects(bucket_id):
            target = root / bucket_id / path
            target.parent.mkdir(parents=True, exist_ok=True)
            client.download(bucket_id, path, target)
            inventory.append({"bucket": bucket_id, "path": path,
                              "bytes": target.stat().st_size, "sha256": sha256_file(target)})
    return {"buckets": buckets, "objects": inventory}


def encrypt(plaintext: pathlib.Path, ciphertext: pathlib.Path, settings: Settings, home: pathlib.Path) -> None:
    home.mkdir(mode=0o700)
    gpg = ["gpg", "--homedir", str(home), "--batch", "--no-tty", "--quiet"]
    run(gpg + ["--import"], input=settings.public_key)
    listed = run(gpg + ["--with-colons", "--list-keys"]).stdout
    fingerprints = {line.split(":")[9] for line in listed.splitlines() if line.startswith("fpr:")}
    if settings.recipient_fingerprint not in fingerprints:
        raise BackupError("public key does not match BACKUP_GPG_FINGERPRINT")
    run(gpg + ["--trust-model", "always", "--recipient", settings.recipient_fingerprint,
               "--output", str(ciphertext), "--encrypt", str(plaintext)])


def captures_to_delete(keys: Iterable[str], now: dt.datetime, retain_days: int, min_keep: int) -> list[str]:
    """Capture prefixes older than the retention window, never the newest min_keep."""
    stamps = {}
    for key in keys:
        if not key.startswith(CAPTURE_PREFIX):
            continue
        prefix = key[len(CAPTURE_PREFIX):].split("/", 1)[0]
        try:
            stamps[prefix] = dt.datetime.strptime(prefix, "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
        except ValueError:
            continue
    ordered = sorted(stamps, key=stamps.get, reverse=True)
    cutoff = now - dt.timedelta(days=retain_days)
    return [CAPTURE_PREFIX + p + "/" for p in ordered[min_keep:] if stamps[p] < cutoff]


def upload_and_confirm(s3, settings: Settings, stamp: str, ciphertext: pathlib.Path,
                       summary: dict, scratch: pathlib.Path) -> None:
    key = f"{CAPTURE_PREFIX}{stamp}/{CIPHERTEXT_NAME}"
    s3.upload_file(str(ciphertext), settings.bucket, key)
    readback = scratch / "readback.gpg"
    s3.download_file(settings.bucket, key, str(readback))
    if sha256_file(readback) != summary["ciphertext"]["sha256"]:
        raise BackupError("stored ciphertext does not match the uploaded bytes")
    readback.unlink()
    s3.put_object(Bucket=settings.bucket, Key=f"{CAPTURE_PREFIX}{stamp}/{SUMMARY_NAME}",
                  Body=json.dumps(summary, indent=2).encode(), ContentType="application/json")


def prune(s3, settings: Settings, now: dt.datetime) -> list[str]:
    keys = []
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=settings.bucket, Prefix=CAPTURE_PREFIX):
        keys.extend(item["Key"] for item in page.get("Contents", []))
    doomed = captures_to_delete(keys, now, settings.retain_days, settings.min_keep)
    for prefix in doomed:
        for key in [k for k in keys if k.startswith(prefix)]:
            s3.delete_object(Bucket=settings.bucket, Key=key)
    return doomed


def main(env: dict[str, str] | None = None) -> int:
    env = dict(os.environ if env is None else env)
    settings = Settings.from_env(env)
    import boto3  # imported late so the pure helpers test without it

    now = dt.datetime.now(dt.timezone.utc)
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    with tempfile.TemporaryDirectory(prefix="openplan-offsite-") as raw:
        scratch = pathlib.Path(raw)
        os.chmod(scratch, 0o700)
        if env.get("BACKUP_PG_CA_PEM", "").strip():
            ca = scratch / "database-ca.crt"
            ca.write_text(env["BACKUP_PG_CA_PEM"])
            os.environ["PGSSLROOTCERT"] = str(ca)
        capture = scratch / "capture"
        capture.mkdir()
        database = dump_database(capture / "database.dump")
        storage = copy_storage(StorageClient(settings), capture / "storage")
        manifest = {"capturedAt": now.isoformat(), "supabaseUrl": settings.supabase_url,
                    "atomic": False, "database": database, **storage}
        (capture / "manifest.json").write_text(json.dumps(manifest, indent=2))
        bundle = scratch / "capture.tar"
        with tarfile.open(bundle, "w") as tar:
            tar.add(capture, arcname=stamp)
        shutil.rmtree(capture)
        ciphertext = scratch / CIPHERTEXT_NAME
        encrypt(bundle, ciphertext, settings, scratch / "gnupg")
        bundle.unlink()
        summary = {
            "capturedAt": now.isoformat(), "atomic": False,
            "recipientFingerprint": settings.recipient_fingerprint,
            "ciphertext": {"bytes": ciphertext.stat().st_size, "sha256": sha256_file(ciphertext)},
            "database": {k: database[k] for k in ("bytes", "sha256", "tocEntries", "serverVersion")},
            "storage": {"buckets": len(storage["buckets"]), "objects": len(storage["objects"]),
                        "bytes": sum(o["bytes"] for o in storage["objects"])},
        }
        from botocore.config import Config
        style = env.get("BACKUP_S3_ADDRESSING_STYLE", "virtual")
        s3 = boto3.client("s3", endpoint_url=env.get("AWS_ENDPOINT_URL") or None,
                          config=Config(s3={"addressing_style": style}))
        upload_and_confirm(s3, settings, stamp, ciphertext, summary, scratch)
        pruned = prune(s3, settings, now)
    print(json.dumps({"event": "offsite_capture_complete", "key": f"{CAPTURE_PREFIX}{stamp}/",
                      "pruned": pruned, **summary}))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BackupError as error:
        print(json.dumps({"event": "offsite_capture_failed", "error": str(error)}))
        sys.exit(1)
