"""Download the newest offsite capture, decrypt it and check every hash.

Run on a machine that holds the private key, never on the backup host:

    BACKUP_BUCKET=... AWS_ENDPOINT_URL=... AWS_ACCESS_KEY_ID=... \
    AWS_SECRET_ACCESS_KEY=... GNUPGHOME=/path/to/private/keyring \
    BACKUP_GPG_PASSPHRASE_FILE=/path/to/passphrase python3 verify_capture.py OUTDIR

It checks the stored ciphertext against its summary, decrypts into OUTDIR,
then checks the database archive hash, that pg_restore can read its index
(when pg_restore is installed), and every Storage object's bytes and SHA-256
against the encrypted manifest. It restores nothing into any database.
"""

from __future__ import annotations

import json
import os
import pathlib
import shutil
import subprocess
import sys
import tarfile

from backup import CAPTURE_PREFIX, CIPHERTEXT_NAME, SUMMARY_NAME, sha256_file


def newest_capture(s3, bucket: str) -> str:
    stamps = set()
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=CAPTURE_PREFIX):
        for item in page.get("Contents", []):
            if item["Key"].endswith("/" + SUMMARY_NAME):
                stamps.add(item["Key"][len(CAPTURE_PREFIX):].split("/", 1)[0])
    if not stamps:
        raise SystemExit("no completed capture in the bucket")
    return max(stamps)


def main(outdir: str) -> int:
    import boto3
    from botocore.config import Config

    env = os.environ
    bucket = env["BACKUP_BUCKET"]
    s3 = boto3.client("s3", endpoint_url=env.get("AWS_ENDPOINT_URL") or None,
                      config=Config(s3={"addressing_style": env.get("BACKUP_S3_ADDRESSING_STYLE", "virtual")}))
    out = pathlib.Path(outdir)
    out.mkdir(mode=0o700, parents=True, exist_ok=False)
    stamp = env.get("BACKUP_CAPTURE") or newest_capture(s3, bucket)
    summary = json.loads(s3.get_object(Bucket=bucket, Key=f"{CAPTURE_PREFIX}{stamp}/{SUMMARY_NAME}")["Body"].read())
    cipher = out / CIPHERTEXT_NAME
    s3.download_file(bucket, f"{CAPTURE_PREFIX}{stamp}/{CIPHERTEXT_NAME}", str(cipher))
    checks = {"capture": stamp, "ciphertextMatchesSummary": sha256_file(cipher) == summary["ciphertext"]["sha256"]}

    plain = out / "capture.tar"
    gpg = ["gpg", "--batch", "--quiet", "--pinentry-mode", "loopback"]
    if env.get("BACKUP_GPG_PASSPHRASE_FILE"):
        gpg += ["--passphrase-file", env["BACKUP_GPG_PASSPHRASE_FILE"]]
    subprocess.run(gpg + ["--output", str(plain), "--decrypt", str(cipher)], check=True)
    with tarfile.open(plain) as tar:
        tar.extractall(out, filter="data")
    plain.unlink()
    root = out / stamp
    manifest = json.loads((root / "manifest.json").read_text())

    dump = root / "database.dump"
    checks["databaseHashMatches"] = sha256_file(dump) == manifest["database"]["sha256"]
    if shutil.which("pg_restore"):
        listing = subprocess.run(["pg_restore", "--list", str(dump)], check=True, capture_output=True, text=True).stdout
        entries = [line for line in listing.splitlines() if line and not line.startswith(";")]
        checks["databaseIndexEntries"] = len(entries)
        checks["databaseIndexMatches"] = len(entries) == manifest["database"]["tocEntries"]

    bad = []
    for item in manifest["objects"]:
        path = root / "storage" / item["bucket"] / item["path"]
        if not path.is_file() or path.stat().st_size != item["bytes"] or sha256_file(path) != item["sha256"]:
            bad.append(f'{item["bucket"]}/{item["path"]}')
    checks["storageObjects"] = len(manifest["objects"])
    checks["storageBytes"] = sum(item["bytes"] for item in manifest["objects"])
    checks["storageMismatches"] = len(bad)
    checks["summaryCountsMatch"] = (summary["storage"]["objects"] == len(manifest["objects"])
                                    and summary["database"]["tocEntries"] == manifest["database"]["tocEntries"])
    print(json.dumps(checks, indent=2))
    passed = all(v for k, v in checks.items() if isinstance(v, bool)) and not bad
    return 0 if passed else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_capture.py OUTDIR")
    sys.exit(main(sys.argv[1]))
