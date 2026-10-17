"""Fifteen NEW supplied data controls. No resource/namespace observation or old cohort."""
import copy
import hashlib
import traceback

PREFIX = b"def budget_policy(used, size, maximum):\n"
END = b"def read_blob(path, maximum, deadline=lambda: None):\n"
REASONS = {'budget_policy': 'pure-write-budget', 'runtime_policy': 'pure-runtime-closure-unresolved',
           'mount_policy': 'pure-unexpected-rw-mount', 'null_setup_policy': 'pure-null-target-before-root-ro'}
MISSING = {'budget_policy': 'pure-guard-control:missing-refusal:budget',
           'runtime_policy': 'pure-guard-control:missing-refusal:runtime',
           'mount_policy': 'pure-guard-control:missing-refusal:mount',
           'null_setup_policy': 'pure-guard-control:missing-refusal:null'}
REASONS.update({'named_readonly': 'pure-named-readonly', 'owned_writable': 'pure-owned-writable'})
MISSING.update({'named_readonly': 'pure-guard-control:missing-refusal:named-readonly',
                'owned_writable': 'pure-guard-control:missing-refusal:owned-writable'})
READONLY_ANCHOR = b"        need(candidates and 'ro' in max(candidates, key=lambda row: len(row['path']))['options'], 'pure-named-readonly')\n"
WRITABLE_ANCHOR = b"    need(all(any(row['path'] == name and 'rw' in row['options'] for row in mounts) for name in rw_paths), 'pure-owned-writable')\n"


def require(value, reason):
    if not value:
        raise RuntimeError(reason)


def detail(error):
    return {'fullClass': type(error).__module__ + '.' + type(error).__qualname__,
            'message': str(error), 'traceback': ''.join(traceback.format_exception(error))}


def run(raw):
    require(raw.count(PREFIX) == raw.count(END) == 1, 'pure-guard-control:source-projection')
    body = raw.split(PREFIX)[1].split(END)[0]
    need_start = raw.index(b'def need(value, reason):\n')
    need_end = raw.index(b'class RootFinalizationError(', need_start)
    projection = raw[need_start:need_end] + PREFIX + body
    functions = ['budget_policy', 'runtime_policy', 'mount_policy', 'null_setup_policy']
    names = list(REASONS)
    anchors = {}
    for index, name in enumerate(functions):
        start = projection.index(('def ' + name + '(').encode())
        stop = projection.index(('def ' + functions[index + 1] + '(').encode()) if index + 1 < len(functions) else len(projection)
        anchors[name] = projection[start:stop]
    require(projection.count(READONLY_ANCHOR) == projection.count(WRITABLE_ANCHOR) == 1,
            'pure-guard-control:mount-branch-anchors')
    anchors.update({'named_readonly': READONLY_ANCHOR, 'owned_writable': WRITABLE_ANCHOR})
    definitions, calls, rows = 0, 0, []
    wanted_request = {'status': 'ROOT_ACCEPTED_SELECTED_STATIC_PYTHON_FOOTPRINT',
                      'manifestSHA256': 'SUPPLIED_NOT_AUTHORITY', 'reviewReceiptSHA256': 'SUPPLIED_NOT_AUTHORITY'}
    wanted_manifest = {'wholeUsrBind': False, 'selectedStaticNeededAliasPathsReviewed': True, 'dynamicABIProved': False,
                       'unresolvedNeeded': [], 'unresolvedAliases': [], 'files': {'/usr/SUPPLIED_ONLY': {}}}
    wanted_receipt = {'decision': 'ACCEPT_EXACT_STATIC_FOOTPRINT_FOR_SOURCE_ONLY_TRIAL03_PREPARATION',
                      'runtimeExecuted': False, 'sourceClosureComplete': False}
    mounts = [{'path': '/', 'options': ['ro']}, {'path': '/owned', 'options': ['rw']}]
    null_argv = ['--ro-bind', '/dev/null', '/dev/null', '--remount-ro', '/', '--dev-bind', '/dev/null', '/dev/null', '--clearenv']
    valid = {'budget_policy': (0, 1, 8), 'runtime_policy': (wanted_request, wanted_manifest, wanted_receipt),
             'mount_policy': (mounts, ['/owned'], ['/']), 'null_setup_policy': (null_argv,)}
    valid.update({'named_readonly': valid['mount_policy'], 'owned_writable': valid['mount_policy']})
    bad_runtime = copy.deepcopy(wanted_request)
    bad_runtime['status'] = 'UNRESOLVED_NOT_ADMITTED'
    invalid = {'budget_policy': (8, 1, 8), 'runtime_policy': (bad_runtime, wanted_manifest, wanted_receipt),
               'mount_policy': (mounts + [{'path': '/unowned', 'options': ['rw']}], ['/owned'], ['/']),
               'null_setup_policy': (null_argv[3:],)}
    invalid.update({'named_readonly': (mounts + [{'path': '/named', 'options': ['rw']}], ['/owned', '/named'], ['/named']),
                    'owned_writable': ([{'path': '/', 'options': ['ro']}], ['/owned'], ['/'])})

    def define(source, identity):
        nonlocal definitions
        namespace = {'__name__': '_m1_new_guard_' + identity, '__file__': 'SUPPLIED_NEW_GUARD::' + identity}
        exec(compile(source, namespace['__file__'], 'exec'), namespace)
        definitions += 1
        return namespace

    def invoke(namespace, name, args):
        nonlocal calls
        function_name = 'mount_policy' if name in ('named_readonly', 'owned_writable') else name
        require(namespace[function_name].__globals__ is namespace, 'pure-guard-control:actual-globals')
        calls += 1
        return namespace[function_name](*copy.deepcopy(args))

    def refuse(namespace, name):
        try:
            invoke(namespace, name, invalid[name])
        except RuntimeError as error:
            if type(error) is not RuntimeError or str(error) != REASONS[name]:
                raise
            return detail(error)
        raise AssertionError(MISSING[name])

    harmless = define(projection + b'\n# Harmless supplied guard annotation.\n', 'harmless')
    for name in names:
        invoke(harmless, name, valid[name])
    rows.append({'name': 'harmless-first', 'outcome': 'SURVIVED'})
    baseline = define(projection, 'baseline')
    for name in names:
        invoke(baseline, name, valid[name])
    rows.append({'name': 'baseline', 'outcome': 'PASS'})
    for name in names:
        rows.append({'name': 'intact:' + name, **refuse(baseline, name)})
        anchor = anchors[name]
        if name in ('named_readonly', 'owned_writable'):
            replacement = b'        pass\n' if name == 'named_readonly' else b'    pass\n'
        else:
            signature = anchor.split(b'\n', 1)[0]
            replacement = signature + b'\n    return None\n\n\n'
        changed = projection.replace(anchor, replacement, 1)
        mutant = define(changed, name + '_omitted')
        try:
            refuse(mutant, name)
        except AssertionError as error:
            if type(error) is not AssertionError or str(error) != MISSING[name]:
                raise
            rows.append({'name': 'omitted:' + name, **detail(error),
                         'mutantSHA256': hashlib.sha256(changed).hexdigest()})
        else:
            raise RuntimeError('pure-guard-control:unexpected-survivor:' + name)
    restored = define(projection, 'restored')
    for name in names:
        invoke(restored, name, valid[name])
    rows.append({'name': 'restored', 'outcome': 'PASS'})
    require(len(rows) == 15 and definitions == 9 and calls == 30, 'pure-guard-control:population')
    return {'authority': 'SUPPLIED_GUARD_DATA_ONLY_NOT_ROOT_AUTHORITY', 'rows': rows,
            'projectionSHA256': hashlib.sha256(projection).hexdigest(), 'namespaceDefinitions': definitions,
            'guardFunctionCalls': calls, 'sourceVariantsMemoryOnly': True, 'newCases': 15,
            'oldRootLifecycleOrResourceReplay': False, 'actualNamespaceOrABIProof': False}
