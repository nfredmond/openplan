# Synthesis supervisor unit generation

This follow-up prepares Linux user-service units for the existing preparation
and execution workers. It does not install a service, create an allowance or
change worker dispatch, locking or journal semantics. The operator supplies an
existing private environment file and the original private journal root.

Twelve focused CLI tests pass. They cover both supported workers, literal path
characters, private permissions, missing source/dependencies, duplicate/unknown
options, unsupported workers, relative paths and control/trailing characters.
Targeted ESLint and diff checks pass. A harmless source comment passes. Removing
private-permission checks, dollar escaping, percent escaping or the worker
allowlist each fails a targeted expectation. Changing restart, child-stop or
umask settings also fails. Restored source passes all twelve cases.

The first run catches a dollar-escaping error: JavaScript replacement-string
semantics collapse the intended doubled dollar. A replacement function fixes
that error. Systemd's native verifier then rejects quoting around the entire
WorkingDirectory value. That setting takes a single path, unlike ExecStart's
quoted arguments. The corrected generator uses the literal path and refuses
application paths whose trailing whitespace or backslash could change parsing.
Neither failed attempt is counted as a pass.

The native disposable probe runs on systemd 259 and Node 24.21.0. Its application,
environment and state paths include spaces, quotes, percent and dollar characters.
The generated unit passes `systemd-analyze --user verify`. The process reads the
exact intended environment and writes its exact cwd and state path. SIGKILL to
that owned service's main process produces one automatic restart with a different
PID and the same paths. An explicit stop records SIGTERM handling and remains
inactive after the restart delay. The probe service is stopped and unlinked.

The probe process is synthetic and contacts no database or provider. It proves
unit parsing and process supervision on this host, not real worker dispatch,
boot, power-loss recovery, clean-host commissioning or workload capacity.
Those M3 outcomes remain open. The unit pins source paths; it does not make an
in-place application update safe. The operator recipe preserves that boundary.

Private commands, fixture events, generated unit and mutation logs are retained
under `synthesis-supervision-20261007-proof` in the local OpenPlan state folder.
No credentials, worker source records or real allowance are used by the probe.
