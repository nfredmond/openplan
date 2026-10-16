# Review this runner before one host-context attestation

Complete a fresh independent round-four review of this exact local commit first.
This packet prepares execution; it does not supply runtime attestation. The parent
retains sole operational ownership. Do not run any application checkout, build
or start command. Keep the current web invocation running unchanged.

The original v3 manifest remains an admission snapshot. Its `candidateExists`
and `executionFiles` fields describe preparation, not today's running web state.
Compare its hash, the new runner hash and all literal pins with the reviewed
public [manifest](manifest.json). The runner checks the copied external manifest,
the original checksum-list hash and each original operation/input hash separately.
A coherently altered private checksum list does not replace the external pins.

After round four clears the exact candidate, the parent uses this single command
once. All paths and hashes are literal. The clean environment precedes shell
startup. This preparation does not execute the command.

```bash
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015 XDG_RUNTIME_DIR=/run/user/1000 /bin/sh -s <<'PARENT'
set -eu
umask 077
/usr/bin/sha256sum --check --strict --status <<'RUNNER' || exit 2
640c666db673aa70a758654722eec625e7491c8120aad3ebe17b57faff19cef3  /home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015/run_attest_host.sh
RUNNER
exec /bin/sh /home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-fix-20261015/run_attest_host.sh
PARENT
```

The new fixed unit is
`openplan-current-project-preview-app-21510042e-v3-attest-host-01.service`.
The runner accepts zero arguments, refuses an alternate/symlink entry, checks
physical roots and external seals, refuses an existing runtime receipt, then
atomically creates its private `attempt-host-01` directory before the unit request.
A refusal, failed unit or lost acknowledgement leaves the attempt reserved.
Preserve it and inspect the exact invocation. Do not delete it or automatically
retry under another unit. This directory is an operating reservation, not a
power-loss-durable transaction. The original attestor retains its fsynced,
exclusive `write_once` receipt behavior.

Python runs directly in host context with 512 MiB, zero swap, CPU 50 percent,
UMask 0077, explicit PATH/HOME, `PYTHONDONTWRITEBYTECODE=1` and `-B`. No outer
bubblewrap surrounds this trusted process observer. It executes the original
v3 `attest_start_v1.py` at its original path and imports the original
`app_binding_v1.py`. The attestor subsequently resets HOME to its original v3
tmp path itself. There is no copied attestor, patched module or selectable map.

The attestor retains exact listener PID acquisition from `ss`; unit/cwd/cgroup;
full sealed environment and full application SHA; build receipt/budget and
non-cache byte comparison; exact 12-character HTTP SHA and migration metadata;
actual readiness and source/global/earlier-helper/Storage preservation; repeated
race checks; and exclusive receipt creation at:

```text
/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3/execution/runtime-start-attestation.json
```

The only additional runner write is its own new attempt directory. The original
attestor performs its own acquisitions, including read-only database/helper
checks. They are parent execution, not work performed by this preparation.
Ordinary same-user filesystem, Docker, proc and network permissions remain
available to that reviewed observer. Resource caps do not confine it. Trust the
reviewed code, absolute host tools/loader, user manager and exclusive same-user
custody. No host sysctl, AppArmor, permission, capability or service setting changes.
The real npm child's existing inner read-only wrapper stays untouched.

Record the new invocation, command exit and receipt hash without printing
credential-bearing process environments or native query output. A successful
unit request alone is insufficient. If the attestor refuses, retain its journal
and partial evidence. Preserve the previous failed attestation invocation
`be8cba835bbe4c14af8ed007cd61bbb2` and its artifacts.

The accepted application remains full SHA
`21510042e94bcaf80f262205ad156a7bb639e35c`, BUILD_ID
`u1jUSo57HKk72eLd1Qv43`, and 2,587-file inventory digest
`fe3a11d7cf20e11e927f3e2c8ca04d37db1121fe2d0815c5ab1b4c9cf78dab55`.
Keep web unit `openplan-current-project-preview-app-21510042e-v3-web.service`
and invocation `34615ba06b554482b0f79c90fe999a61`. Never stop, restart or alter it
for this correction. Do not repeat build hashing campaigns, source recovery,
SQL mutations, helpers or earlier application stages.

After a real attestation, identified desktop/390px journeys, console review,
login/decryption and usable artifacts still need their own evidence. Native
Excel, practicing-planner/public acceptance, scientific validity and production
capacity remain unproved. T3 capture remains unresolved. Full v1 geography,
science and free/open-source obligations remain unchanged.
