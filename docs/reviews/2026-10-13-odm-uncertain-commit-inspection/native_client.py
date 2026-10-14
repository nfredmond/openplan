"""Use actual private RPC and an original failed task through the owned observer."""
import argparse
import hashlib
import http.client
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from urllib.parse import urlsplit
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'workers/odm_worker'))
from application_dispatch_http import Transport as ApplicationTransport
from application_dispatch_reader import Reader
from draft_http import Transport as DraftTransport
from native_engine_attestation import Attestor
from runtime_admission import Runtime
from runtime_dispatch_custody import Custody
from runtime_draft import Draft
from runtime_preparation import Preparation
from runtime_url_draft import Pipeline as UrlDraft
from runtime_url_intake import Intake
from runtime_observation import Observer
from runtime_commit import Commit
from original_commit_http import Transport as CommitTransport
from application_processing_authority import Authority as ProcessingAuthority
from retained_source import json_bytes
from retained_task_observation import Observations
from uncertain_commit_inspection import Inspection


def run(config, phase, root):
    if phase != 'runtime-uncertain-inspection':
        path = ROOT / 'docs/reviews/2026-10-13-odm-original-processing-commit/native_client.py'
        spec = importlib.util.spec_from_file_location('original_native_draft_client', path)
        helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(helper)
        return helper.run(config, phase, root)
    request = json.loads(config['payloadText'])
    request_id = request['requestId']
    runtime = Runtime(root, config['scope']['installationId'], max_queued=2, pipeline=lambda job: None)
    custody = Custody(runtime, config['scope']['targetId'], timeout=10)
    token = config['serviceToken']
    transport = ApplicationTransport(config['endpoint'], 'retained-own-service',
        lambda reference: {'apiKey':token, 'bearerToken':token}, allow_http=True)
    reads = []
    def read(arguments, deadline, *, owned):
        reads.append(arguments)
        return transport(arguments, deadline, owned=owned)
    reader = Reader(custody, read, timeout=10)
    native = json.loads(Path(os.environ['OPENPLAN_NATIVE_COMPOSITION_ENGINE']).read_bytes())
    def refuse(*args, **kwargs):
        raise AssertionError('Native runtime observation cannot refetch, resupply or issue a draft')
    with runtime.owner():
        entry = runtime.journal.get(request_id)
        intake = Intake(runtime, root.parent/'missing-source', custody.target, refuse, refuse, timeout=10)
        frozen = UrlDraft(intake, refuse, refuse, timeout=10)
        deadline = time.monotonic() + 10
        preparation = Preparation(runtime, lambda value: frozen._inputs(value, deadline), timeout=10)
        effects, prepared = Draft(preparation, refuse, refuse, timeout=10)._effects(request_id, deadline)
        plan = effects.plan
        assert plan['engine'] == native['engine'], 'Runtime original must bind its actual native engine'
        before = effects.snapshot()
        assert all(row['state'] == 'acknowledged' for row in before['commands'][:-1]) and before['commands'][-1]['state'] == 'unissued', 'Experimental original commit must follow only acknowledged drafts'
        attestor = Attestor(plan['engine'], native['socketPath'], native['daemonUid'])
        commit_checks = []
        def commit_attest(engine, end, *, owned):
            commit_checks.append(engine)
            return attestor(engine, end, owned=owned)
        authority = ProcessingAuthority(reader, plan['engine'], commit_attest)
        commit_transport = CommitTransport(plan, lambda reference: None,
            lambda engine, end: commit_attest(engine, end, owned=lambda: runtime._owned))
        def lose_reply(plan, end, *, owned):
            commit_transport(plan, end, owned=owned)
            raise ConnectionError('Deliberate lost native original commit acknowledgment')
        commit = Commit(Draft(preparation, refuse, refuse, timeout=10), authority, lose_reply, timeout=10)
        original_spawn = subprocess.Popen
        commit_children = []
        def commit_spawn(arguments, **options):
            process = original_spawn(arguments, **options)
            if len(arguments) >= 3 and arguments[:2] == [sys.executable, '-B']:
                commit_children.append(Path(arguments[2]).name)
            return process
        before_reads = len(reads)
        with patch.object(subprocess, 'Popen', side_effect=commit_spawn):
            try:
                commit.advance(request_id)
            except ConnectionError as error:
                assert str(error) == 'Deliberate lost native original commit acknowledgment'
            else:
                raise AssertionError('Native uncertain commit must lose its exact acknowledgment')
            replayed = commit.advance(request_id)
        assert replayed['state'] == 'held_uncertain', 'Native lost original commit must remain held without reissue'
        assert not (prepared/'engine/command-00003.reply.json').exists(), 'Lost native acknowledgment cannot become a fabricated exact reply'
        assert commit_children.count('original_commit_http.py') == 1 and commit_children.count('application_dispatch_http.py') == 2 and commit_children.count('native_engine_attestation.py') == 3, 'Native uncertain commit must use two application reads, three engine checks and one supervised POST'
        assert len(reads) - before_reads == 2 and len(commit_checks) == 3, 'Native uncertain replay cannot query another permission or engine'
        assert replayed['callbackPermission'] is False and replayed['publicationPermission'] is False and replayed['processingQualityVerification'] == 'unassessed', 'Native uncertain commit cannot promote quality or publication'
        endpoint = urlsplit(plan['engine']['endpoint'])
        deadline = time.monotonic() + 10
        while True:
            connection = http.client.HTTPConnection(endpoint.hostname, endpoint.port, timeout=2)
            try:
                connection.request('GET', '/task/' + plan['taskUuid'] + '/info')
                response = connection.getresponse()
                body = response.read(1048577)
                value = json.loads(body)
            finally:
                connection.close()
            if value.get('status', {}).get('code') == 30:
                break
            assert value.get('status', {}).get('code') in (10, 20), 'Invalid ordinary inputs cannot establish accepted processing'
            if time.monotonic() >= deadline:
                raise TimeoutError('Native invalid task did not fail')
            time.sleep(.1)
        attestor = Attestor(plan['engine'], native['socketPath'], native['daemonUid'])
        checks = []
        def attest(engine, end, *, owned):
            checks.append(engine)
            return attestor(engine, end, owned=owned)
        observer = Observer(reader, lambda reference: None, attest, timeout=10)
        original_spawn = subprocess.Popen
        children = []
        def spawn(arguments, **options):
            process = original_spawn(arguments, **options)
            if len(arguments) >= 3 and arguments[:2] == [sys.executable, '-B']:
                children.append(Path(arguments[2]).name)
            return process
        with patch.object(subprocess, 'Popen', side_effect=spawn):
            inspected = Inspection(commit, observer).inspect(request_id)
            result = inspected['taskObservation']
        assert inspected['commitAcknowledgmentState'] == 'unresolved' and not (prepared/'engine/command-00003.reply.json').exists(), 'Native inspection cannot acknowledge the lost exact commit reply'
        assert inspected['commitRetryPermission'] is False and inspected['publicationPermission'] is False, 'Native inspection cannot grant retry or publication'
        assert commit.advance(request_id)['state'] == 'held_uncertain', 'Native inspected commit must still hold without reissue'
        assert len(commit_checks) == 3 and len(reads) == 5, 'Inspection cannot obtain another processing grant or POST' 
        assert children.count('original_task_http.py') == 1 and children.count('application_dispatch_http.py') == 3 and children.count('native_engine_attestation.py') == 2, 'Runtime native observation must launch the exact supervised read children'
        assert len(reads) == 5 and len(checks) == 2, 'Actual runtime observation must check current access and native identity'
        assert result['task']['bodySha256'] == hashlib.sha256(body).hexdigest(), 'Actual runtime metadata must bind the independent native reply'
        assert result['task']['reportedState'] == 'failed' and result['task']['reportedImageCount'] == 2, 'Runtime reported native failure cannot become processing success'
        assert result['commitPermission'] is False and result['callbackPermission'] is False and result['publicationPermission'] is False, 'Runtime observation cannot grant effects or publication'
        saved = Observations(prepared/'engine', plan, records_root=prepared/'task-observations').load(result['task']['bodySha256'])
        target = root.parent/'copied-observation-root'
        shutil.copytree(prepared, target)
        copied = Observations(target/'engine', plan, records_root=target/'task-observations').load(result['task']['bodySha256'])
        assert copied == saved, 'Runtime local copied reply must remain exact without another engine read'
        assert not (root.parent/'missing-source').exists(), 'Runtime observation cannot recreate an absent download root'
        return {'actualRuntimeTaskRead':True, 'actualOriginalCommit':True, 'commitApplicationReads':2, 'commitEngineChecks':3, 'commitPosts':1, 'commitReplayHeld':True, 'commitReplyUnresolved':True, 'applicationReads':len(reads) - 2, 'nativeEngineChecks':len(checks),
            'taskGets':children.count('original_task_http.py'), 'bodySha256':result['task']['bodySha256'], 'reportedState':'failed',
            'reportedImageCount':2, 'noPermissionPromotion':True, 'localCopiedReplyExact':True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config', type=Path)
    parser.add_argument('phase')
    parser.add_argument('root', type=Path)
    parser.add_argument('result', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    result = run(json.loads(args.config.read_bytes()), args.phase, args.root)
    args.result.write_bytes(json_bytes(result))
