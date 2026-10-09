"""Route assignment child reads and progress through its inherited parent channel."""
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path
import threading

_CURRENT = ContextVar('openplan_engine_binding', default=None)


def current():
    return _CURRENT.get()


class EngineBinding:
    def __init__(self, client, *, run_id, stage_id, work_directory, output_name):
        self.client = client
        self.run_id = run_id
        self.stage_id = stage_id
        self.work_directory = str(Path(work_directory).absolute())
        self.output_name = output_name
        self.owner = threading.get_ident()

    def check(self):
        if threading.get_ident() != self.owner:
            raise ValueError('Engine binding belongs to another thread')

    def read_run(self, run_id):
        self.check()
        if run_id != self.run_id:
            raise ValueError('Engine requested another run')
        result = self.client.read_run()
        if result.get('id') != self.run_id:
            raise ValueError('Parent returned another run')
        return result

    def patch_stage(self, stage_id, payload):
        self.check()
        if stage_id != self.stage_id or set(payload) != {'log_tail'}:
            raise ValueError('Engine may report only its own stage progress')
        return self.client.progress(payload['log_tail'])

    def paths(self, work_dir):
        self.check()
        if str(Path(work_dir).absolute()) != self.work_directory:
            raise ValueError('Engine requested another workspace')
        result = self.client.read_paths()
        if result.get('work_directory') != self.work_directory:
            raise ValueError('Parent returned another workspace')
        return result

    def project_directory(self, work_dir):
        return self.paths(work_dir)['project_directory']

    def package_directory(self, work_dir, supplied):
        expected = self.paths(work_dir)['package_directory']
        if supplied != expected:
            raise ValueError('Engine package differs from parent working copy')
        return expected

    def create_outputs(self, work_dir, name):
        self.check()
        if str(Path(work_dir).absolute()) != self.work_directory or name != self.output_name:
            raise ValueError('Engine output request differs from parent configuration')
        return self.client.create_outputs()['output_directory']


@contextmanager
def bind(binding):
    if current() is not None:
        raise ValueError('Engine binding is already active')
    binding.check()
    token = _CURRENT.set(binding)
    try:
        yield binding
    finally:
        _CURRENT.reset(token)
