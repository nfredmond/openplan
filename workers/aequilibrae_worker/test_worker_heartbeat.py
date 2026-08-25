import unittest
from unittest.mock import Mock, patch
import requests

from worker_heartbeat import WorkerHeartbeat


class WorkerHeartbeatTest(unittest.TestCase):
    def test_emits_kind_capabilities_and_current_work(self):
        heartbeat = WorkerHeartbeat(
            supabase_url="http://db.test",
            service_key="service-key",
            worker_kind="aequilibrae",
            supported_stages=("AequilibraE Setup", "Network Assignment", "Artifact Extraction"),
            runtime_mode="poll",
        )
        heartbeat.set_current_work({"runId": "run-1", "stageName": "Network Assignment"})
        response = Mock()
        response.raise_for_status.return_value = None
        with patch("worker_heartbeat.requests.post", return_value=response) as post:
            self.assertTrue(heartbeat.emit_once())
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["worker_kind"], "aequilibrae")
        self.assertEqual(payload["current_work"]["runId"], "run-1")
        self.assertIn("Artifact Extraction", payload["supported_stages"])

    def test_failed_heartbeat_does_not_raise(self):
        heartbeat = WorkerHeartbeat(
            supabase_url="http://db.test",
            service_key="service-key",
            worker_kind="aequilibrae",
            supported_stages=("AequilibraE Setup",),
            runtime_mode="poll",
        )
        with patch("worker_heartbeat.requests.post", side_effect=requests.RequestException("offline")):
            self.assertFalse(heartbeat.emit_once())


if __name__ == "__main__":
    unittest.main()
