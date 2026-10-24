"""Unit tests for the offsite capture's pure parts and failure refusals.

Blind category: these do not reach a real database, Supabase Storage or an S3
bucket. The scheduled run's own read-back and the operator's decrypt-and-list
check cover those.
"""

import datetime as dt
import hashlib
import io
import json
import pathlib
import shutil
import subprocess
import tempfile
import unittest
import urllib.parse

import backup

# Synthetic keys only. LEGACY_JWT decodes to {"alg":"HS256"} / {"role":"service_role"}
# with a made-up signature; SECRET_KEY only borrows the documented prefix.
LEGACY_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c3ludGhldGljLXNpZ25hdHVyZQ"
SECRET_KEY = "sb_secret_synthetic-unit-test-only_0000"

BASE_ENV = {
    "SUPABASE_URL": "https://example.supabase.co/",
    "SUPABASE_SERVICE_ROLE_KEY": LEGACY_JWT,
    "BACKUP_BUCKET": "synthetic-bucket",
    "BACKUP_GPG_FINGERPRINT": "abc",
    "BACKUP_GPG_PUBLIC_KEY": "synthetic",
    "PGHOST": "db.example", "PGUSER": "u", "PGPASSWORD": "p", "PGDATABASE": "postgres",
    "PGSSLMODE": "verify-full", "BACKUP_PG_CA_PEM": "synthetic-ca",
}


class SettingsTest(unittest.TestCase):
    def test_accepts_complete_settings(self):
        settings = backup.Settings.from_env(BASE_ENV)
        self.assertEqual(settings.supabase_url, "https://example.supabase.co")
        self.assertEqual(settings.recipient_fingerprint, "ABC")
        self.assertEqual((settings.retain_days, settings.min_keep), (30, 7))

    def test_refuses_unverified_database_tls(self):
        for mode in ("require", "", "disable"):
            with self.assertRaisesRegex(backup.BackupError, "verify-full"):
                backup.Settings.from_env({**BASE_ENV, "PGSSLMODE": mode})

    def test_refuses_missing_ca_and_missing_credentials(self):
        env = {k: v for k, v in BASE_ENV.items() if k != "BACKUP_PG_CA_PEM"}
        with self.assertRaisesRegex(backup.BackupError, "CA"):
            backup.Settings.from_env(env)
        with self.assertRaisesRegex(backup.BackupError, "BACKUP_GPG_PUBLIC_KEY"):
            backup.Settings.from_env({**BASE_ENV, "BACKUP_GPG_PUBLIC_KEY": " "})


class RetentionTest(unittest.TestCase):
    def keys(self, days_ago):
        now = dt.datetime(2026, 11, 30, 10, 0, tzinfo=dt.timezone.utc)
        out = []
        for d in days_ago:
            stamp = (now - dt.timedelta(days=d)).strftime("%Y%m%dT%H%M%SZ")
            out += [f"captures/{stamp}/openplan-capture.tar.gpg", f"captures/{stamp}/summary.json"]
        return now, out

    def test_deletes_only_captures_past_the_window(self):
        now, keys = self.keys([0, 1, 2, 3, 4, 5, 6, 7, 31, 40])
        doomed = backup.captures_to_delete(keys + ["notes/readme.txt", "captures/bad/x"], now, 30, 7)
        self.assertEqual(len(doomed), 2)
        self.assertTrue(all(p.startswith("captures/202610") for p in doomed))

    def test_keeps_the_newest_captures_even_when_old(self):
        # A job that stops running for weeks must not prune its last copies.
        now, keys = self.keys([60, 61, 62])
        self.assertEqual(backup.captures_to_delete(keys, now, 30, 7), [])
        self.assertEqual(len(backup.captures_to_delete(keys, now, 30, 2)), 1)


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


class FakeStorage:
    """Two buckets, a nested folder and more than one list page."""

    def __init__(self, key=LEGACY_JWT):
        self.key = key
        self.files = {("maps", f"p/{i:04d}.zip"): f"zip-{i}".encode() for i in range(1001)}
        self.files[("maps", "p/sub/readme.md")] = b"nested"
        self.files[("reports", "r.pdf")] = b"%PDF"

    def __call__(self, request, timeout):
        # urllib stores header names capitalized: "apikey" arrives as "Apikey".
        expected = {"Apikey": self.key}
        if self.key == LEGACY_JWT:
            expected["Authorization"] = "Bearer " + LEGACY_JWT
        sent = {name: value for name, value in request.headers.items() if name in ("Apikey", "Authorization")}
        assert sent == expected, sorted(sent)
        path = urllib.parse.unquote(request.full_url.split("/storage/v1", 1)[1])
        if path == "/bucket":
            return FakeResponse(json.dumps([{"id": "maps"}, {"id": "reports"}]).encode())
        if path.startswith("/object/list/"):
            bucket = path[len("/object/list/"):]
            body = json.loads(request.data)
            prefix = body["prefix"]
            names = set()
            for (b, p) in self.files:
                if b != bucket or not p.startswith(prefix + "/" if prefix else ""):
                    continue
                rest = p[len(prefix) + 1:] if prefix else p
                head = rest.split("/", 1)
                names.add((head[0], len(head) == 1))
            entries = [{"name": n, "id": "x" if is_file else None} for n, is_file in sorted(names)]
            page = entries[body["offset"]:body["offset"] + body["limit"]]
            return FakeResponse(json.dumps(page).encode())
        if path.startswith("/object/authenticated/"):
            bucket, obj = path[len("/object/authenticated/"):].split("/", 1)
            return FakeResponse(self.files[(bucket, obj)])
        raise AssertionError(path)


class StorageCopyTest(unittest.TestCase):
    def test_copies_every_object_across_pages_and_folders_with_hashes(self):
        fake = FakeStorage()
        client = backup.StorageClient(backup.Settings.from_env(BASE_ENV), opener=fake)
        with tempfile.TemporaryDirectory() as raw:
            root = pathlib.Path(raw)
            result = backup.copy_storage(client, root)
            self.assertEqual(len(result["objects"]), len(fake.files))
            for item in result["objects"]:
                data = fake.files[(item["bucket"], item["path"])]
                self.assertEqual(item["sha256"], hashlib.sha256(data).hexdigest())
                self.assertEqual((root / item["bucket"] / item["path"]).read_bytes(), data)

    def test_secret_key_reaches_storage_only_on_apikey(self):
        fake = FakeStorage(SECRET_KEY)
        client = backup.StorageClient(backup.Settings.from_env({**BASE_ENV, "SUPABASE_SERVICE_ROLE_KEY": SECRET_KEY}),
                                      opener=fake)
        with tempfile.TemporaryDirectory() as raw:
            result = backup.copy_storage(client, pathlib.Path(raw))
        self.assertEqual(len(result["objects"]), len(fake.files))

    def test_legacy_jwt_headers_keep_their_original_order(self):
        self.assertEqual(list(backup.service_key_headers(LEGACY_JWT).items()),
                         [("Authorization", "Bearer " + LEGACY_JWT), ("apikey", LEGACY_JWT)])
        self.assertEqual(backup.service_key_headers(SECRET_KEY), {"apikey": SECRET_KEY})

    def test_refuses_an_object_path_that_escapes_the_capture(self):
        for bad in ("../etc/passwd", "a//b", "/abs", "a/./b", ""):
            with self.assertRaises(backup.BackupError):
                backup.safe_object_path(bad)
        self.assertEqual(backup.safe_object_path("a/b c.pdf"), "a/b c.pdf")


@unittest.skipUnless(shutil.which("gpg"), "gpg is not installed")
class EncryptionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self.tmp.name)
        self.keyring = self.root / "operator"
        self.keyring.mkdir(mode=0o700)
        gpg = ["gpg", "--homedir", str(self.keyring), "--batch", "--quiet", "--pinentry-mode", "loopback", "--passphrase", ""]
        subprocess.run(gpg + ["--quick-generate-key", "Synthetic backup <synthetic@example.invalid>", "ed25519", "cert", "never"], check=True, capture_output=True)
        listed = subprocess.run(gpg + ["--with-colons", "--list-keys"], check=True, capture_output=True, text=True).stdout
        self.fpr = next(line.split(":")[9] for line in listed.splitlines() if line.startswith("fpr:"))
        subprocess.run(gpg + ["--quick-add-key", self.fpr, "cv25519", "encr", "never"], check=True, capture_output=True)
        self.public = subprocess.run(gpg + ["--armor", "--export", self.fpr], check=True, capture_output=True, text=True).stdout
        self.gpg = gpg

    def tearDown(self):
        self.tmp.cleanup()

    def test_only_the_private_key_holder_can_read_the_capture(self):
        settings = backup.Settings.from_env({**BASE_ENV, "BACKUP_GPG_FINGERPRINT": self.fpr, "BACKUP_GPG_PUBLIC_KEY": self.public})
        plain = self.root / "capture.tar"
        plain.write_bytes(b"synthetic database and objects")
        cipher = self.root / "capture.tar.gpg"
        backup.encrypt(plain, cipher, settings, self.root / "worker-home")
        self.assertNotIn(b"synthetic database", cipher.read_bytes())
        out = subprocess.run(self.gpg + ["--decrypt", str(cipher)], check=True, capture_output=True).stdout
        self.assertEqual(out, plain.read_bytes())

    def test_refuses_a_public_key_that_does_not_match_the_fingerprint(self):
        settings = backup.Settings.from_env({**BASE_ENV, "BACKUP_GPG_FINGERPRINT": "0" * 40, "BACKUP_GPG_PUBLIC_KEY": self.public})
        plain = self.root / "capture.tar"
        plain.write_bytes(b"x")
        with self.assertRaisesRegex(backup.BackupError, "does not match"):
            backup.encrypt(plain, self.root / "out.gpg", settings, self.root / "worker-home")


class FakeS3:
    def __init__(self, corrupt=False):
        self.objects = {}
        self.corrupt = corrupt

    def upload_file(self, filename, bucket, key):
        self.objects[key] = pathlib.Path(filename).read_bytes()

    def download_file(self, bucket, key, filename):
        data = self.objects[key]
        pathlib.Path(filename).write_bytes(data + (b"!" if self.corrupt else b""))

    def put_object(self, Bucket, Key, Body, ContentType):
        self.objects[Key] = Body


class UploadTest(unittest.TestCase):
    def run_upload(self, s3):
        settings = backup.Settings.from_env(BASE_ENV)
        with tempfile.TemporaryDirectory() as raw:
            scratch = pathlib.Path(raw)
            cipher = scratch / "c.gpg"
            cipher.write_bytes(b"ciphertext")
            summary = {"ciphertext": {"sha256": hashlib.sha256(b"ciphertext").hexdigest(), "bytes": 10}}
            backup.upload_and_confirm(s3, settings, "20261012T101700Z", cipher, summary, scratch)

    def test_writes_ciphertext_then_summary_after_a_matching_read_back(self):
        s3 = FakeS3()
        self.run_upload(s3)
        self.assertEqual(sorted(s3.objects), ["captures/20261012T101700Z/openplan-capture.tar.gpg",
                                              "captures/20261012T101700Z/summary.json"])

    def test_fails_without_a_summary_when_the_stored_bytes_differ(self):
        s3 = FakeS3(corrupt=True)
        with self.assertRaisesRegex(backup.BackupError, "does not match"):
            self.run_upload(s3)
        self.assertNotIn("captures/20261012T101700Z/summary.json", s3.objects)


if __name__ == "__main__":
    unittest.main()
