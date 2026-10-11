"""Exercise archived stop/readiness preconditions without starting any service."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import sys
from types import SimpleNamespace

SOURCE = Path(__file__).parent / 'drivers/final_preservation.py'


def execute(node, environment):
    module = ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[]))
    exec(compile(module, str(SOURCE), 'exec'), environment)


def expect_refusal(node, environment, message):
    try:
        execute(node, environment)
    except (ValueError, RuntimeError) as error:
        if str(error) == message:
            return
        raise AssertionError('Unexpected precondition refusal') from error
    raise AssertionError('Missing precondition refusal: ' + message)


def main(output):
    original = SOURCE.read_bytes()
    tree = ast.parse(original)
    function = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
    stops = [n for n in ast.walk(function) if isinstance(n, ast.If)
             and 'State' in ast.unparse(n.test) and 'Running' in ast.unparse(n.test)]
    readiness = next(n for n in ast.walk(function) if isinstance(n, ast.For)
                     and ast.unparse(n.iter) == 'range(40)')
    records = []
    for node in stops:
        message = node.body[0].exc.args[0].value
        def environment(running):
            return {'receipt': {'id': 'synthetic-identity'},
                    'services': SimpleNamespace(inspect=lambda identity: {
                        'State': {'Running': running}, 'harmless': True})}
        execute(node, environment(False))
        execute(ast.parse('# harmless comment\n' + ast.unparse(node)).body[0], environment(False))
        expect_refusal(node, environment(True), message)
        omitted = ast.Pass()
        try:
            expect_refusal(omitted, environment(True), message)
        except AssertionError as error:
            if str(error) != 'Missing precondition refusal: ' + message:
                raise
        else:
            raise AssertionError('Omitted stop precondition survived its oracle')
        records.append({'case': message, 'baselineAndHarmlessPassed': True,
                        'runningRefused': True, 'omittedGuardFailsIntendedOracle': True})
    def readiness_environment(statuses):
        statuses = iter(statuses)
        return {'subprocess': SimpleNamespace(run=lambda *a, **k: SimpleNamespace(returncode=next(statuses))),
                'time': SimpleNamespace(sleep=lambda duration: None),
                'receipt': {'id': 'synthetic-identity'}, 'database': 'synthetic-database'}
    execute(readiness, readiness_environment([0]))
    execute(readiness, readiness_environment([1, 0]))
    message = readiness.orelse[0].exc.args[0].value
    expect_refusal(readiness, readiness_environment([1] * 40), message)
    omitted = copy.deepcopy(readiness)
    omitted.orelse = []
    try:
        expect_refusal(omitted, readiness_environment([1] * 40), message)
    except AssertionError as error:
        if str(error) != 'Missing precondition refusal: ' + message:
            raise
    else:
        raise AssertionError('Omitted readiness precondition survived its oracle')
    execute(readiness, readiness_environment([0]))
    if SOURCE.read_bytes() != original:
        raise AssertionError('Archived source changed')
    records.append({'case': message, 'baselineAndHarmlessPassed': True,
                    'exhaustedReadinessRefused': True, 'omittedGuardFailsIntendedOracle': True})
    result = {'sourceSha256': hashlib.sha256(original).hexdigest(), 'cases': records,
              'scope': 'Extracted exact archived AST nodes with fake service observations. No native identity, readiness timing, process stopping, database or filesystem acceptance.'}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(len(records), 'final driver preconditions controlled')


if __name__ == '__main__':
    main(Path(sys.argv[1]))
