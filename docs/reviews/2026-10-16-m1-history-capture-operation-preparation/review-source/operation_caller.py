"""Held source seam only. No executable entry, ROOT admission or launch wrapper."""
import os
from pathlib import Path
import traceback

HERE = Path(__file__).resolve().parent
SAVED_TOC = Path('/home/nathaniel/.local/state/openplan/land-use-context-native-preparation-20261016/empty-root-toc-consumer-preparation-r2/output-01/toc.stdout.bin')
ARCHIVE_SHA256 = '181caa01d5ebe66b50da9dcba1242b225e75cfdc8bd0fe03e3c4a9ae86e4d398'
ARCHIVE_METADATA = (
    ('path', '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump'),
    ('resolvedPath', '/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015/source-private.dump'),
    ('bytes', 16232305), ('mode', 384), ('uid', 1000), ('gid', 1000),
    ('device', 66308), ('inode', 180785957), ('mtimeNs', 1792053880663155876),
    ('ctimeNs', 1792053880663155876), ('regularFile', True))
# No operation approval source or ROOT receipt is supplied by this preparation.
OPERATION_SOURCE_APPROVAL = None


class OperationHeld(RuntimeError):
    pass


class OperationRefusal(RuntimeError):
    pass


class OperationFinalizationError(RuntimeError):
    def __init__(self, message, terminal):
        super().__init__(message)
        self.terminal = terminal


def detail(error):
    return {'fullClass': type(error).__module__ + '.' + type(error).__qualname__,
            'message': str(error), 'traceback': ''.join(traceback.format_exception(error))}


def require(value, message):
    if not value:
        raise OperationRefusal(message)


def chunk_size(used, raw, maximum):
    require(used + len(raw) <= maximum, 'history-operation:stream-cap')


def capture_after_separate_root_admission(boundary):
    """Future SOURCE-bound ROOT supplies verified modules and narrow callbacks."""
    if OPERATION_SOURCE_APPROVAL is None:
        raise OperationHeld('history-operation:admission-source-absent')
    primary = saved = None
    fd = None
    capture_entered = False
    captured = None
    assessment = None
    issues, attempts = [], []
    terminal = None

    def attempt(operation, action):
        attempts.append(operation)
        try:
            return action()
        except BaseException as error:
            issues.append({'operation': operation, **detail(error)})

    def capture_record(name, value):
        nonlocal captured
        if name == 'history.terminal.json':
            # Retain the same in-memory object, including callback-failure updates.
            captured = value
        boundary.record(name, value)

    def final_archive_readback():
        # Held descriptor hashing precedes close and remains subject to expiry.
        result = archive.binary_readback(fd, expected, ARCHIVE_SHA256, boundary.deadline)
        boundary.record('archive.postparse.json', result)

    expected = dict(ARCHIVE_METADATA)
    try:
        core, archive, capture = boundary.core, boundary.archive, boundary.capture
        boundary.deadline()
        require(core.PRODUCTION_ORACLE_APPROVAL is None, 'history-operation:oracle-must-remain-absent')
        # Future ROOT owns bounded source-data reads and pins their exact bytes.
        core.validate_selection(boundary.selection, boundary.saved_toc)
        core.validate_argv(core.FIXED_ARGV)
        # Future ROOT must bind exact grant/receipt/source/argv, expiry, resources,
        # entry INV/client PID, named RO mounts, EROFS, security and private env.
        boundary.verify_initial_admission()
        boundary.deadline()
        require(core.FIXED_ARGV[-1] == expected['path'] == archive.ARCHIVE_PATH,
                'history-operation:archive-path-agreement')
        archive.path_metadata(expected)
        # Own the descriptor before validating it. Do not call old open_binary,
        # whose exception handler can lose its comparison error during close.
        fd = os.open(expected['path'], os.O_RDONLY | os.O_CLOEXEC | os.O_NOFOLLOW | os.O_NONBLOCK)
        archive.compare(os.fstat(fd), expected)
        boundary.record('archive.preparse.json', archive.binary_readback(
            fd, expected, ARCHIVE_SHA256, boundary.deadline))
        boundary.verify_before_tool()
        boundary.deadline()
        capture_entered = True
        returned = capture.capture_once(list(core.FIXED_ARGV), boundary.environment,
                                       boundary.deadline, capture_record, chunk_size)
        require(returned is captured and returned['returncode'] == 0
                and returned['status'] == 'CAPTURED' and returned['partialFailure'] is None
                and returned['cleanupIssues'] == [] and returned['terminalRecordFailure'] is None
                and returned['retainedBytes']['stderr'] == returned['observedBytes']['stderr'] == 0,
                'history-operation:raw-capture-completion')
        # Neither a captured stream nor an oracle body is opened or supplied.
        try:
            core.assess_production(None, None)
        except core.HistoryUnassessed as error:
            if type(error) is not core.HistoryUnassessed or str(error) != 'history-oracle-absent':
                raise
            assessment = {'rawCaptureRecorded': True, 'rawToolReturncode': returned['returncode'],
                          'rawStreams': returned['streams'], 'accepted': False,
                          'envelope': 'UNASSESSED', 'history': 'UNASSESSED',
                          'assessmentExit': 2, 'toolFailure': False, **detail(error)}
            boundary.record('history.assessment.json', assessment)
        else:
            raise OperationRefusal('history-operation:absent-oracle-promoted')
    except BaseException as error:
        primary, saved = error, error.__traceback__
    finally:
        if fd is not None:
            if capture_entered:
                attempt('archive.postparse-readback', final_archive_readback)
            else:
                # Do not retry a refused preparse hash. Check the held FD only.
                attempt('archive.final-fd-metadata', lambda: archive.compare(os.fstat(fd), expected))
            attempt('archive.close', lambda: os.close(fd))
            fd = None
        # These callbacks must remain non-writing and safe after partial setup.
        attempt('final.input-source-readback', lambda: boundary.final_source_readback())
        attempt('final.mount-security-readback', lambda: boundary.final_mount_security_readback())
        status = 'CAPTURED_UNASSESSED' if primary is None and not issues and assessment is not None else 'FAILED'
        terminal = {'operationStatus': status, 'managerExit': 0 if status == 'CAPTURED_UNASSESSED' else 1,
                    'rawToolReturncode': captured['returncode'] if captured is not None else None,
                    'rawCaptureTerminal': captured, 'assessment': assessment,
                    'primaryFailure': detail(primary) if primary is not None else None,
                    'finalizationAttempts': attempts, 'finalizationIssues': issues,
                    'terminalRecordAttempted': True, 'terminalRecordFailure': None,
                    'productionApproval': None, 'history': 'UNASSESSED', 'retry': False}
        try:
            boundary.record('operation.terminal.json', terminal)
        except BaseException as error:
            terminal['terminalRecordFailure'] = detail(error)
            terminal['operationStatus'], terminal['managerExit'] = 'FAILED', 1
    if primary is not None:
        if issues or terminal['terminalRecordFailure'] is not None:
            secondary = OperationFinalizationError('history-operation:finalization-failed', terminal)
            secondary.original_primary_cause, secondary.original_primary_context = primary.__cause__, primary.__context__
            raise BaseException.with_traceback(primary, saved) from secondary
        raise BaseException.with_traceback(primary, saved)
    if terminal['managerExit'] != 0:
        raise OperationFinalizationError('history-operation:finalization-failed', terminal)
    return terminal
