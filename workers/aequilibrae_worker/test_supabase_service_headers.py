"""Service-key headers for legacy JWT keys and Supabase secret keys.

Proves the helper's two shapes, two real call sites that use it, and that no
worker module still builds a Bearer header from the service key by hand. Does
not prove that a hosted Supabase gateway accepts either key; that needs a live
project.
"""
from pathlib import Path
import re
import unittest
from unittest.mock import Mock, patch

import model_storage_readback as readback
from supabase_service_headers import is_legacy_jwt_key, service_key_headers
from worker_heartbeat import WorkerHeartbeat

# Synthetic values only. The JWT decodes to {"alg":"HS256"} / {"role":"service_role"}
# with a made-up signature; the secret key only borrows the documented prefix.
LEGACY_JWT = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c3ludGhldGljLXNpZ25hdHVyZQ"
SECRET_KEY = "sb_secret_synthetic-unit-test-only_0000"


class HelperShape(unittest.TestCase):
    def test_legacy_jwt_sends_both_headers_unchanged(self):
        self.assertEqual(service_key_headers(LEGACY_JWT),
                         {"apikey": LEGACY_JWT, "Authorization": "Bearer " + LEGACY_JWT})

    def test_secret_key_sends_only_apikey(self):
        self.assertEqual(service_key_headers(SECRET_KEY), {"apikey": SECRET_KEY})

    def test_publishable_key_sends_only_apikey(self):
        key = "sb_publishable_synthetic-unit-test-only"
        self.assertEqual(service_key_headers(key), {"apikey": key})

    def test_only_a_whole_three_part_jwt_counts_as_legacy(self):
        for near_miss in (
            "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0",  # two parts
            LEGACY_JWT + ".extra",  # four parts
            LEGACY_JWT + "\n",  # trailing newline must not pass a `$` anchor
            " " + LEGACY_JWT,
            "xeyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln",  # wrong prefix
            "eyJhbGciOiJIUzI1NiJ9..c2ln",  # empty middle segment
            "eyJhbGciOiJIUzI1NiJ9.eyJy+b2xl.c2ln",  # not base64url
            "",
        ):
            with self.subTest(near_miss=near_miss):
                self.assertFalse(is_legacy_jwt_key(near_miss))
                self.assertNotIn("Authorization", service_key_headers(near_miss))
        self.assertFalse(is_legacy_jwt_key(None))


class CallSites(unittest.TestCase):
    def readback_headers(self, key):
        seen = {}

        def get(url, **kwargs):
            seen.update(kwargs["headers"])
            response = Mock(status_code=404)
            response.__enter__ = Mock(return_value=response)
            response.__exit__ = Mock(return_value=False)
            return response

        self.assertFalse(readback.verify_object(base_url="http://127.0.0.1:54321", service_key=key,
                                                bucket="run-artifacts", object_path="a/b.txt",
                                                sha256="0" * 64, size_bytes=1, get=get))
        return seen

    def test_storage_readback_headers_follow_the_key_type(self):
        self.assertEqual(self.readback_headers(LEGACY_JWT),
                         {"apikey": LEGACY_JWT, "Authorization": "Bearer " + LEGACY_JWT,
                          "Accept-Encoding": "identity"})
        self.assertEqual(self.readback_headers(SECRET_KEY),
                         {"apikey": SECRET_KEY, "Accept-Encoding": "identity"})

    def heartbeat_headers(self, key):
        heartbeat = WorkerHeartbeat(supabase_url="http://db.test", service_key=key, worker_kind="aequilibrae",
                                    supported_stages=("AequilibraE Setup",), runtime_mode="poll")
        response = Mock()
        response.raise_for_status.return_value = None
        with patch("worker_heartbeat.requests.post", return_value=response) as post:
            self.assertTrue(heartbeat.emit_once())
        return post.call_args.kwargs["headers"]

    def test_heartbeat_headers_follow_the_key_type(self):
        legacy = self.heartbeat_headers(LEGACY_JWT)
        self.assertEqual(legacy["Authorization"], "Bearer " + LEGACY_JWT)
        self.assertEqual(legacy["apikey"], LEGACY_JWT)
        secret = self.heartbeat_headers(SECRET_KEY)
        self.assertNotIn("Authorization", secret)
        self.assertEqual(secret["apikey"], SECRET_KEY)
        self.assertEqual(secret["Prefer"], "resolution=merge-duplicates,return=minimal")


class NoHandBuiltServiceBearer(unittest.TestCase):
    """A new call site must use the helper rather than a literal Bearer header."""

    PATTERN = re.compile(r"Bearer[^\n]{0,40}(service_key|SUPABASE_KEY|service_role_key)")

    def test_worker_modules_do_not_build_a_service_bearer(self):
        workers = Path(__file__).resolve().parent.parent
        offenders = []
        for directory in ("aequilibrae_worker", "activitysim_worker"):
            for path in sorted((workers / directory).glob("*.py")):
                if path.name.startswith("test_") or path.name == "supabase_service_headers.py":
                    continue
                for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
                    if self.PATTERN.search(line):
                        offenders.append(f"{directory}/{path.name}:{number}")
        self.assertEqual(offenders, [])


if __name__ == "__main__":
    unittest.main()
