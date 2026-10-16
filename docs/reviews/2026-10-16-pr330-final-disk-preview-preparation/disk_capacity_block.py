"""Disk-backed capacity functions inserted into the inherited storage controller.

The controller supplies ROOT, DURABLE, SOURCE_BYTES, GiB, HOST_RESERVE,
OUTPUT_RESERVE, EVIDENCE_RESERVE, DISK_RESERVE, require and inventory.
"""


def mount_check(observed):
    require(observed['target'] == '/' and observed['fstype'] == 'ext4' and
            observed['source'] == '/dev/nvme0n1p2' and
            observed['uuid'] == 'c7f8e9a2-2767-4dba-81a8-5ae1ade8d595', 'disk-mount-identity')
    flags = set(observed['options'].split(','))
    require('rw' in flags and 'noexec' not in flags, 'disk-execution')


def capacity_check(available, working_free, durable_free, staged=0):
    # Source, output and custody reside on disk. Page cache used during a build
    # remains charged to that build's unchanged 10 GiB cgroup and is reclaimable.
    # No disk or tmpfs free bytes count as extra RAM.
    require(type(staged) is int and staged >= 0, 'disk-staged-count')
    memory_required = 10*GiB + HOST_RESERVE
    require(available >= memory_required, 'disk-memory-total-budget')
    raw = SOURCE_BYTES + OUTPUT_RESERVE + EVIDENCE_RESERVE
    working_required = max(0, raw-staged)
    archive_raw = max(raw, staged)
    archive_required = archive_raw + archive_raw//100 + DISK_RESERVE
    # Both directories share this identified filesystem. Reserve working bytes
    # AND an uncompressed-size archive together, rather than counting free twice.
    combined_required = working_required + archive_required
    require(min(working_free, durable_free) >= 8*GiB, 'disk-headroom-floor')
    require(min(working_free, durable_free) >= combined_required, 'disk-combined-budget')
    return {'available': available, 'workingFree': working_free, 'durableFree': durable_free,
            'sourceBytes': SOURCE_BYTES, 'stagedBytes': staged,
            'outputReservation': OUTPUT_RESERVE, 'unitCap': 10*GiB,
            'hostReservation': HOST_RESERVE, 'memoryRequired': memory_required,
            'workingRequired': working_required, 'archiveRequired': archive_required,
            'durableRequired': combined_required, 'storage': 'disk'}


def observe_capacity():
    require(ROOT.parent.resolve() == ROOT.parent and DURABLE.resolve() == DURABLE,
            'disk-parent-symlink')
    require(os.stat(ROOT.parent).st_dev == os.stat(DURABLE).st_dev, 'disk-shared-device')
    result = subprocess.run(['/usr/bin/findmnt', '-J', '-T', str(ROOT.parent), '-o',
                             'TARGET,SOURCE,FSTYPE,OPTIONS,UUID'],
                            capture_output=True, check=True, timeout=5)
    mount = json.loads(result.stdout)['filesystems']
    require(len(mount) == 1, 'disk-mount-census')
    mount_check(mount[0])
    available = int(next(x.split()[1] for x in Path('/proc/meminfo').read_text().splitlines()
                         if x.startswith('MemAvailable:')))*1024
    staged = sum(x.get('bytes', 0) for x in inventory(ROOT).values()) if ROOT.exists() else 0
    return capacity_check(available, shutil.disk_usage(ROOT.parent).free,
                          shutil.disk_usage(DURABLE).free, staged)
