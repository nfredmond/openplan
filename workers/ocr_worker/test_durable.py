"""Crash recovery at accepted/result checkpoints, with the real SQLite store."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

import durable
import intake
import main
from test_worker_http import ocr_request


def checks():
    with tempfile.TemporaryDirectory() as directory:
        main.CONFIG["work_dir"] = directory
        request = ocr_request()
        # A separate process exits without graceful worker shutdown after acceptance.
        script = "import json,main,os; main.CONFIG['work_dir']=os.environ['TEST_JOB_DIR']; main.register_job(json.loads(os.environ['TEST_JOB_REQUEST'])); os._exit(19)"
        result = subprocess.run([sys.executable, "-B", "-c", script], cwd=Path(__file__).parent,
                                env={**os.environ, "TEST_JOB_DIR": directory, "TEST_JOB_REQUEST": json.dumps(request)})
        assert result.returncode == 19
        jobs = durable.load(directory)
        assert len(jobs) == 1, "acknowledged request must survive process death"
        job = jobs[0]
        accepted = job["accepted_callback"]
        assert accepted["requestId"] == request["requestId"]

        source_bytes = b"%PDF-1.7\nretained-test-original"
        request["source"].update(checksumSha256=hashlib.sha256(source_bytes).hexdigest(), sizeBytes=len(source_bytes))
        source_dir = Path(directory) / job["job_reference"]
        source_dir.mkdir()
        original = source_dir / "source.pdf"
        original.write_bytes(source_bytes)
        job["request"] = request
        def no_fetch(*args):
            raise AssertionError("a retained checksum-bound original must not need an expired URL")
        assert intake.prepare_source(request["source"], str(source_dir), 4096, no_fetch) == str(original)
        pages = [{"page": 1, "text": "Reference table"}, {"page": 2, "text": ""}]
        with patch.object(main.callbacks_module, "post_callback", return_value=(False, "application unavailable")):
            main.process_job(job, recognize=lambda *args, **kwargs: (pages, 2, "test"))
        recovered = durable.load(directory)[0]
        assert recovered["state"] == "undelivered", "delivery failure must remain retryable"
        assert recovered["result"]["pages"] == pages, "complete result including blank pages must survive"
        assert original.read_bytes() == source_bytes, "undelivered source bytes must remain"
        result_payload = recovered["result"]
        with patch.object(main.callbacks_module, "post_callback", return_value=(True, "delivered")) as post:
            main.process_job(recovered, prepare=no_fetch, recognize=no_fetch)
        assert post.call_args.args[2] == result_payload, "retry must send exact callback identity and pages"
        assert durable.load(directory)[0]["state"] == "succeeded"
        assert durable.load(directory)[0]["accepted_callback"] == accepted

        # A disk error after HTTP success must not replace the retained result.
        checkpoint_job = main.register_job(ocr_request("checkpoint-request-123"))
        real_save = main.durable.save
        def failing_save(work_dir, row):
            if row["state"] == "succeeded":
                raise OSError("injected disk failure after delivery")
            return real_save(work_dir, row)
        with patch.object(main.durable, "save", side_effect=failing_save), patch.object(main.callbacks_module, "post_callback", return_value=(True, "delivered")) as post:
            main.process_job(checkpoint_job, prepare=lambda *args: str(original), recognize=lambda *args, **kwargs: (pages, 2, "test"))
        assert checkpoint_job["state"] == "undelivered"
        assert checkpoint_job["result"]["status"] == "succeeded", "disk failure must not rewrite computed success"
        assert checkpoint_job["result"]["pages"] == pages
        assert [call.args[2]["status"] for call in post.call_args_list] == ["running", "succeeded"]

        refreshed = json.loads(json.dumps(request))
        refreshed["source"]["url"] = "https://storage.example.com/new-signed-link"
        assert durable.same_request(request, refreshed)
        refreshed["externalRef"]["documentId"] = "foreign-document"
        assert not durable.same_request(request, refreshed), "same request ID cannot redirect custody"
        canceled = main.register_job(ocr_request("cancel-request-123"))
        canceled["cancel_requested"] = True
        with patch.object(main.callbacks_module, "post_callback", return_value=(False, "offline")):
            main.process_job(canceled, prepare=no_fetch, recognize=no_fetch)
        assert canceled["state"] == "undelivered"
        assert canceled["result"]["status"] == "canceled"
    print("durable acceptance, exact result retry, retained source, identity and cancellation checks passed")


if __name__ == "__main__":
    checks()
