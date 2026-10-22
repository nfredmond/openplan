"""Probe driver ownership and client overflow/deadline guards without an engine.

Client HTTP events use a controlled adapter inside the same cached Node runtime.
No real network or owned engine service runs. Mutations use fresh memory copies.
"""
import argparse
import ast
import copy
import hashlib
import importlib.util
import inspect
import json
import os
from pathlib import Path
import subprocess

DRIVER = Path(__file__).with_name('native_reconciliation.py')
spec = importlib.util.spec_from_file_location('draft_driver_controls', DRIVER)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

ADAPTER = r"""
const EventEmitter = require('events');
const http = {request: (_options, callback) => {
  const request = new EventEmitter();
  request.setTimeout = (_delay, handler) => { request.deadline = handler; };
  request.destroy = error => { request.destroyed = true; request.emit('error', error); };
  request.end = () => setImmediate(() => {
    if (FIXTURE === 'deadline' && request.deadline) { request.deadline(); return; }
    const response = new EventEmitter();
    response.statusCode = 200;
    response.destroy = error => { response.destroyed = true; response.emit('error', error); };
    callback(response);
    response.emit('data', Buffer.alloc(FIXTURE === 'overflow' ? 1048577 : 1, 'x'));
    if (!response.destroyed) response.emit('end');
  });
  return request;
}};
"""


def run(out):
    out.mkdir(mode=0o700)
    original = DRIVER.read_bytes()
    rows = []
    path = out/'synthetic-owner'
    value = {'Config': {'Labels': {'openplan.proof': str(path)}}}
    wrong = copy.deepcopy(value)
    wrong['Config']['Labels']['openplan.proof'] = str(out/'another-owner')
    source = inspect.getsource(driver.check_owner)
    def ownership(label, code):
        namespace = {}
        try:
            exec(compile(code, str(DRIVER), 'exec'), namespace)
            check = namespace['check_owner']
            if check(value, path) != value:
                raise AssertionError('Original owner must survive')
            try:
                check(wrong, path)
            except ValueError as error:
                if str(error) != 'Refusing an unowned container':
                    raise
            else:
                raise AssertionError('Another owner must be refused before any stop action')
            rows.append({'control': label, 'outcome': 'survived'})
        finally:
            namespace.clear()
    ownership('owner-baseline', source)
    ownership('owner-harmless-comment', source+'\n# Harmless owner-control comment.\n')
    needle = "if value['Config']['Labels'].get('openplan.proof') != str(out):"
    if source.count(needle) != 1:
        raise ValueError('Owner mutation anchor differs')
    try:
        ownership('owner-guard-removed', source.replace(needle, 'if False:', 1))
    except AssertionError as error:
        if str(error) != 'Another owner must be refused before any stop action':
            raise
        rows.append({'control': 'owner-guard-removed', 'outcome': 'intended_failure', 'reason': str(error)})
    else:
        raise AssertionError('Removed ownership guard survived')
    ownership('owner-restored', source)
    def client(label, fixture, code, expected):
        needle = "const http = require('http');"
        if code.count(needle) != 1:
            raise ValueError('Client adapter anchor differs')
        script = 'const FIXTURE = '+json.dumps(fixture)+';\n'+code.replace(needle, ADAPTER, 1)
        result = subprocess.run(['docker', 'run', '--rm', '--pull=never', '-i', '--network=none',
                                 '--read-only', '--memory=64m', '--memory-swap=64m', '--cpus=1',
                                 '--pids-limit=64', '--cap-drop=ALL', '--security-opt=no-new-privileges',
                                 '--entrypoint=/usr/bin/node', driver.IMAGE, '-e', script],
                                input=b'{"path":"/synthetic-only","method":"GET","headers":{}}',
                                capture_output=True, timeout=15)
        (out/(label+'.stdout')).write_bytes(result.stdout)
        (out/(label+'.stderr')).write_bytes(result.stderr)
        if result.returncode != expected:
            raise AssertionError('Client must refuse '+fixture+' through its intended guard')
        reason = b'response bound' if fixture == 'overflow' else b'request deadline'
        if expected == 1 and reason not in result.stderr:
            raise AssertionError('Client refusal reached the wrong diagnostic')
        return result.returncode
    for fixture in ['overflow', 'deadline']:
        for label, code in [('baseline', driver.CLIENT), ('harmless-comment', driver.CLIENT+'\n// Harmless client control.\n')]:
            client(fixture+'-'+label, fixture, code, 1)
            rows.append({'control': fixture+'-'+label, 'outcome': 'survived'})
        if fixture == 'overflow':
            needle = 'count > 1048576'
            changed = driver.CLIENT.replace(needle, 'false', 1)
        else:
            needle = "req.setTimeout(5000, () => req.destroy(new Error('request deadline')));"
            changed = driver.CLIENT.replace(needle, '// Deadline guard deliberately removed.', 1)
        if driver.CLIENT.count(needle) != 1:
            raise ValueError('Client mutation anchor differs')
        try:
            client(fixture+'-guard-removed', fixture, changed, 1)
        except AssertionError as error:
            if str(error) != 'Client must refuse '+fixture+' through its intended guard':
                raise
            rows.append({'control': fixture+'-guard-removed', 'outcome': 'intended_failure', 'reason': str(error)})
        else:
            raise AssertionError('Removed '+fixture+' guard survived')
        client(fixture+'-restored', fixture, driver.CLIENT, 1)
        rows.append({'control': fixture+'-restored', 'outcome': 'survived'})
    if DRIVER.read_bytes() != original:
        raise ValueError('Driver changed during memory-only controls')
    (out/'controls.json').write_text(json.dumps(rows, indent=2)+'\n')
    (out/'source-bindings.json').write_text(json.dumps({DRIVER.name:hashlib.sha256(original).hexdigest(),
                                                     Path(__file__).name:hashlib.sha256(Path(__file__).read_bytes()).hexdigest()},indent=2)+'\n')
    print(json.dumps({'controls':len(rows),'positive':9,'broken':3,
                      'nativeNetworkOrEngineExecuted':False,'sourceUnchanged':True}))


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    run(parser.parse_args().out.absolute())
