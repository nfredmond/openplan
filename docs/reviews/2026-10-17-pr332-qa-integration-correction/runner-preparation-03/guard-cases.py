"""Six-case local control source. This module has no dispatch or subject imports."""
import os
from pathlib import Path
import traceback


class WriteBinding:
    def __init__(self, callback):
        self.callback = callback

    def __getattr__(self, name):
        return self.callback if name == 'write' else getattr(os, name)


def observed_error(operation):
    try:
        operation()
    except BaseException as error:
        return {'name': type(error).__name__, 'message': str(error)}
    return None


def p_write(module, root, evidence):
    path = root / 'writer'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    calls = []
    native = module.os
    def one_byte(handle, data):
        count = os.write(handle, data[:1])
        calls.append(count)
        return count
    try:
        module.os = WriteBinding(one_byte)
        returned = module.write_all(fd, b'12345678')
    finally:
        module.os = native
        os.close(fd)
    actual = path.read_bytes()
    evidence['actualBytes'] = actual.hex()
    evidence['calls'] = calls
    evidence['returned'] = returned
    assert actual == b'12345678' and calls == [1] * 8 and returned == 8, 'P-WRITE.actual-eight'
    refusals = {}
    for label, value in (('zero', 0), ('string', 'x')):
        counter = [0]
        def hostile(handle, data):
            counter[0] += 1
            if counter[0] >= 3:
                raise RuntimeError('local_callback_limit')
            return value
        try:
            module.os = WriteBinding(hostile)
            refusals[label] = observed_error(lambda: module.write_all(-1, b'12345678'))
        finally:
            module.os = native
    evidence['refusals'] = refusals
    assert refusals['zero'] == {'name': 'RuntimeError', 'message': 'invalid_actual_write_count'}, 'P-WRITE.zero-refusal'
    assert refusals['string'] == {'name': 'RuntimeError', 'message': 'invalid_actual_write_count'}, 'P-WRITE.string-refusal'


def p_readback(module, root, evidence):
    path = root / 'readback'
    path.write_bytes(b'12345678')
    positive = module.readback(path, b'12345678')
    path.write_bytes(b'1234567X')
    refusal = observed_error(lambda: module.readback(path, b'12345678'))
    evidence.update({'positiveBytes': positive['bytes'], 'actualBytes': path.read_bytes().hex(), 'refusal': refusal})
    assert positive['bytes'] == 8 and path.read_bytes() == b'1234567X', 'P-READBACK.fixture-bytes'
    assert refusal == {'name': 'RuntimeError', 'message': 'saved_file_readback_mismatch:' + str(path)}, 'P-READBACK.hash-refusal'


def p_independent(module, root, evidence):
    def primary_callback():
        raise ValueError('local_primary')
    try:
        primary_callback()
    except ValueError as error:
        primary = module.error_info(error)
    def cleanup_callback():
        raise OSError('local_cleanup')
    marker_a, marker_b = root / 'marker-a', root / 'marker-b'
    observed = None
    caught = None
    try:
        observed = module.independent_actions(primary, [
            ('cleanup', cleanup_callback),
            ('marker-a', lambda: marker_a.write_bytes(b'A')),
            ('marker-b', lambda: marker_b.write_bytes(b'B')),
        ])
    except BaseException as error:
        caught = {'name': type(error).__name__, 'message': str(error)}
    markers = [path.read_bytes().hex() if path.exists() else None for path in (marker_a, marker_b)]
    primary_ok = observed is not None and observed['primary'] == primary and 'primary_callback' in primary['traceback'] and 'local_primary' in primary['traceback']
    cleanup_ok = observed is not None and len(observed['errors']) == 1 and observed['errors'][0]['step'] == 'cleanup' and observed['errors'][0]['type'] == 'OSError' and observed['errors'][0]['message'] == 'local_cleanup' and 'cleanup_callback' in observed['errors'][0]['traceback']
    later_ok = observed is not None and observed['completed'] == [{'step': 'marker-a', 'value': 1}, {'step': 'marker-b', 'value': 1}]
    evidence.update({'primary': primary, 'outcome': observed, 'caught': caught, 'markers': markers,
                     'assertions': {'primary': primary_ok, 'cleanup': cleanup_ok, 'later': later_ok, 'readback': markers == ['41', '42']}})
    assert markers == ['41', '42'] and later_ok, 'P-INDEPENDENT.later-markers'
    assert primary_ok, 'P-INDEPENDENT.primary-custody'
    assert cleanup_ok, 'P-INDEPENDENT.cleanup-separate'
    assert marker_a.read_bytes() == b'A' and marker_b.read_bytes() == b'B', 'P-INDEPENDENT.marker-readback'


def p_metadata(module, root, evidence):
    path = root / 'metadata'
    path.write_bytes(b'12345678')
    path.chmod(0o600)
    base = module.descriptor(path)
    module.pinned([base])
    module.pinned([base], inner=True)
    path.chmod(0o400)
    mode = observed_error(lambda: module.pinned([base], inner=True))
    path.chmod(0o600)
    base = module.descriptor(path)
    alternate = root / 'alternate'
    alternate.write_bytes(b'12345678')
    os.replace(alternate, path)
    inode = observed_error(lambda: module.pinned([base], inner=True))
    base = module.descriptor(path)
    target = root / 'target'
    target.write_bytes(b'12345678')
    path.unlink()
    path.symlink_to(target.name)
    symlink = observed_error(lambda: module.pinned([base], inner=True))
    path.unlink()
    path.write_bytes(b'12345678')
    path.chmod(0o600)
    base = module.descriptor(path)
    owner_refusals = {}
    host_refusals = {}
    for field in ('uid', 'gid'):
        changed = dict(base, **{field: 0})
        owner_refusals[field] = observed_error(lambda: module.compare_descriptor(base, changed, inner=True))
        expected = dict(base, **{field: base[field] + 1})
        host_refusals[field] = observed_error(lambda: module.pinned([expected]))
    # These supplied descriptors are synthetic owner-view inputs. No system
    # path, map, ownership change or privilege operation is read or simulated.
    system_paths = ('/usr/bin/node', '/usr/bin/python3.14', '/usr/bin/bwrap',
                    '/usr/bin/systemd-run', '/usr/bin/systemctl', '/usr/include/node/node_version.h')
    views, other_fields = [], []
    for system_path in system_paths + ('/usr/bin/python3',):
        expected = dict(base, path=system_path, uid=0, gid=0)
        if system_path == '/usr/bin/python3':
            expected.update(type='symlink', target='python3.14', resolved='/usr/bin/python3.14')
            expected.pop('nonsymlink')
        actual = dict(expected, uid=12345, gid=23456)
        views.append(module.compare_descriptor(expected, actual, inner=True))
        changed = dict(actual, mode=actual['mode'] ^ 1)
        other_fields.append(observed_error(lambda: module.compare_descriptor(expected, changed, inner=True)))
    unknown = dict(base, path='/usr/bin/not-an-approved-input', uid=0, gid=0)
    unknown_refusal = observed_error(lambda: module.compare_descriptor(unknown, unknown, inner=True))
    evidence.update({'mode': mode, 'inode': inode, 'symlink': symlink, 'strictOwner': owner_refusals,
                     'hostOwner': host_refusals, 'syntheticSystemViews': views, 'otherFields': other_fields,
                     'unknown': unknown_refusal, 'actualBytes': path.read_bytes().hex()})
    assert mode is not None and mode['message'] == 'complete_input_descriptor_changed:' + str(path), 'P-METADATA.mode-refusal'
    assert inode is not None and inode['message'] == 'complete_input_descriptor_changed:' + str(path), 'P-METADATA.inode-refusal'
    assert symlink is not None and symlink['message'] == 'input_not_regular_nonsymlink:' + str(path), 'P-METADATA.symlink-refusal'
    assert all(item == {'name': 'RuntimeError', 'message': 'complete_input_descriptor_changed:' + str(path)} for item in owner_refusals.values()), 'P-METADATA.strict-owner-refusal'
    assert all(item == {'name': 'RuntimeError', 'message': 'complete_input_descriptor_changed:' + str(path)} for item in host_refusals.values()), 'P-METADATA.host-owner-refusal'
    assert len(views) == 7 and all(view['systemOwnerParity'] == 'UNPROVED' and view['actualUID'] == 12345 and view['actualGID'] == 23456 for view in views), 'P-METADATA.explicit-system-owner-view'
    assert all(item == {'name': 'RuntimeError', 'message': 'inner_system_nonowner_descriptor_changed:' + system_path} for item, system_path in zip(other_fields, system_paths + ('/usr/bin/python3',))), 'P-METADATA.system-other-field-refusal'
    assert unknown_refusal == {'name': 'RuntimeError', 'message': 'inner_unknown_owner_path:/usr/bin/not-an-approved-input'}, 'P-METADATA.no-general-exemption'
    assert path.read_bytes() == b'12345678', 'P-METADATA.fixture-readback'


CASES = {'P-WRITE': p_write, 'P-READBACK': p_readback, 'P-INDEPENDENT': p_independent, 'P-METADATA': p_metadata}
