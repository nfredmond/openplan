"""Persist accepted OCR requests and exact callback payloads before acknowledging them."""

from contextlib import closing
import json
import os
import sqlite3


def connect(work_dir):
    os.makedirs(work_dir, mode=0o700, exist_ok=True)
    os.chmod(work_dir, 0o700)
    path = os.path.join(work_dir, "jobs.sqlite3")
    connection = sqlite3.connect(path, timeout=30)
    os.chmod(path, 0o600)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=FULL")
    connection.execute("CREATE TABLE IF NOT EXISTS jobs (request_id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
    return connection


def save(work_dir, job):
    with closing(connect(work_dir)) as connection, connection:
        connection.execute(
            "INSERT INTO jobs VALUES (?, ?) ON CONFLICT(request_id) DO UPDATE SET payload=excluded.payload",
            (job["request"]["requestId"], json.dumps(job, ensure_ascii=False)),
        )


def load(work_dir, active_only=False):
    with closing(connect(work_dir)) as connection, connection:
        query = "SELECT payload FROM jobs"
        if active_only:
            query += " WHERE json_extract(payload, '$.state') IN ('accepted','running','undelivered')"
        return [json.loads(row[0]) for row in connection.execute(query + " ORDER BY rowid")]


def get(work_dir, request_id):
    with closing(connect(work_dir)) as connection, connection:
        row = connection.execute("SELECT payload FROM jobs WHERE request_id=?", (request_id,)).fetchone()
        return json.loads(row[0]) if row else None


def same_request(left, right):
    """Only an expiring download URL may change, and only for checksum-bound bytes."""
    left = json.loads(json.dumps(left))
    right = json.loads(json.dumps(right))
    if left.get("source", {}).get("checksumSha256"):
        left["source"].pop("url", None)
        right.get("source", {}).pop("url", None)
    return left == right
