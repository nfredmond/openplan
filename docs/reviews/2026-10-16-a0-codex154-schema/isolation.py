"""Bounded proof namespaces. These constructors do not run a provider."""
from pathlib import Path


def directory(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path or not path.is_dir():
        raise ValueError('resolved-absolute-directory-required')
    return str(path)


def offline(package, proof):
    package, proof = directory(package), directory(proof)
    return ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-all',
            '--clearenv', '--tmpfs', '/', '--ro-bind', '/usr', '/usr',
            '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib',
            '--symlink', 'usr/lib64', '/lib64', '--dev', '/dev', '--proc', '/proc',
            '--dir', '/tool', '--ro-bind', package, '/tool', '--dir', '/proof',
            '--bind', proof, '/proof', '--chdir', '/proof',
            '--setenv', 'HOME', '/proof/home', '--setenv', 'CODEX_HOME', '/proof/home/.codex',
            '--setenv', 'XDG_CONFIG_HOME', '/proof/xdg', '--setenv', 'PATH', '/usr/bin:/bin']


def scoped(checkout, private, donor):
    checkout, private, donor = map(directory, (checkout, private, donor))
    if checkout == donor or private == donor:
        raise ValueError('donor-must-not-be-writable-root')
    # Explicit donor protection follows writable mounts. It also protects a
    # donor below a wider checkout mount, independent of cache configuration.
    return ['/usr/bin/bwrap', '--die-with-parent', '--new-session', '--unshare-net',
            '--ro-bind', '/', '/', '--bind', checkout, checkout,
            '--bind', private, private, '--ro-bind', donor, donor,
            '--dev', '/dev', '--proc', '/proc', '--chdir', checkout,
            '--clearenv', '--setenv', 'HOME', private,
            '--setenv', 'PATH', '/usr/bin:/bin',
            '--setenv', 'PYTHONDONTWRITEBYTECODE', '1']
