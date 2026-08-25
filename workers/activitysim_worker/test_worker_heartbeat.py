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
