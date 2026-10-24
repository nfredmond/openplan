import unittest
from unittest.mock import Mock, patch
import requests

from worker_heartbeat import WorkerHeartbeat


class WorkerHeartbeatTest(unittest.TestCase):
    def test_emits_activitysim_capability(self):
        heartbeat = WorkerHeartbeat(
            supabase_url="http://db.test",
            service_key="service-key",
            worker_kind="activitysim",
            supported_stages=("ActivitySim Bundle & Preflight",),
            runtime_mode="preflight_only",
        )
        response = Mock()
        response.raise_for_status.return_value = None
        with patch("worker_heartbeat.requests.post", return_value=response) as post:
            self.assertTrue(heartbeat.emit_once())
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["worker_kind"], "activitysim")
        self.assertEqual(payload["runtime_mode"], "preflight_only")

    def test_secret_key_goes_only_on_apikey_and_legacy_jwt_keeps_bearer(self):
        # Synthetic values. This copy reaches the shared helper beside the
        # AequilibraE worker, which is what the ActivitySim images carry.
        legacy = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c3ludGhldGljLXNpZ25hdHVyZQ"
        secret = "sb_secret_synthetic-unit-test-only_0000"
        sent = {}
        for key in (legacy, secret):
            heartbeat = WorkerHeartbeat(
                supabase_url="http://db.test",
                service_key=key,
                worker_kind="activitysim",
                supported_stages=("ActivitySim Bundle & Preflight",),
                runtime_mode="preflight_only",
            )
            response = Mock()
            response.raise_for_status.return_value = None
            with patch("worker_heartbeat.requests.post", return_value=response) as post:
                self.assertTrue(heartbeat.emit_once())
            sent[key] = post.call_args.kwargs["headers"]
        self.assertEqual((sent[legacy]["apikey"], sent[legacy]["Authorization"]), (legacy, "Bearer " + legacy))
        self.assertEqual(sent[secret]["apikey"], secret)
        self.assertNotIn("Authorization", sent[secret])

    def test_failed_heartbeat_does_not_raise(self):
        heartbeat = WorkerHeartbeat(
            supabase_url="http://db.test",
            service_key="service-key",
            worker_kind="activitysim",
            supported_stages=("ActivitySim Bundle & Preflight",),
            runtime_mode="preflight_only",
        )
        with patch("worker_heartbeat.requests.post", side_effect=requests.RequestException("offline")):
            self.assertFalse(heartbeat.emit_once())


if __name__ == "__main__":
    unittest.main()
