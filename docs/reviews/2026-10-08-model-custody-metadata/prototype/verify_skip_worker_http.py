"""Use both real worker skip paths and the installed migration over native HTTP."""
from pathlib import Path
import json
import inspect
import os
import sys
import types
from unittest.mock import patch
from verify_skip_http_recovery import verify, REPO
from worker_import_for_tests import import_worker_main


def main():
    root = Path(os.environ['OPENPLAN_MODEL_COMMAND_PROOF_OUTPUT'])
    root.mkdir(mode=0o700, parents=True, exist_ok=False)
    aeq = import_worker_main()
    sys.path.insert(0, str(REPO / 'workers/activitysim_worker'))
    import supabase_poll
    results = []
    for name, worker in [('aequilibrae', aeq), ('activitysim', supabase_poll)]:
        original = worker.get_prior_stage_statuses
        source = inspect.getsource(original)
        anchor = 'status,error_message,updated_at'
        if source.count(anchor) != 1:
            raise AssertionError('Prior-stage projection anchor changed')
        for control, body in [('baseline', source), ('harmless', source + '\n# Harmless comment.\n'),
                              ('missing-version', source.replace(anchor, 'status,error_message')), ('restored', source)]:
            namespace = dict(worker.__dict__)
            exec(compile(body, str(Path(worker.__file__)), 'exec'), namespace)
            compiled = namespace['get_prior_stage_statuses']
            # Use the module's live globals so the owned endpoint/credential
            # overrides inside verify() apply to the mutated reader too.
            replacement = types.FunctionType(compiled.__code__, worker.__dict__, compiled.__name__, compiled.__defaults__, compiled.__closure__)
            with patch.object(worker, 'get_prior_stage_statuses', replacement):
                try:
                    result = verify(None, root / name / control, worker)
                except AssertionError as error:
                    if control != 'missing-version' or str(error) != 'Worker did not retain one command journal':
                        raise
                    results.append({'worker': name, 'control': control, 'expected_failure': str(error)})
                else:
                    if control == 'missing-version':
                        raise AssertionError('Missing predecessor version passed native worker proof')
                    results.append({'worker': name, 'control': control, 'result': result})
        if worker.get_prior_stage_statuses is not original:
            raise AssertionError('Worker function was not restored')
    result = {'workers': results, 'limits': 'Actual mark_stage_skipped functions, predecessor/run HTTP reads, installed migration20, committed lost replies and fresh CLI recovery. Stage input read from native SQL. Not a complete poll/push loop, engine execution, whole-run restart or scientific acceptance.'}
    (root / 'skip-worker-http.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
