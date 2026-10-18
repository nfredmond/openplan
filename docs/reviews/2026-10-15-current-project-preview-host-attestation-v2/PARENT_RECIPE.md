# Review both corrections before parent execution

This is a preparation template. One new independent round-four review must clear
both host context and exact npm PATH enforcement before the parent uses it once.
Keep the accepted build and sole web invocation unchanged. Do not build or start.
The parent compares every literal pin in manifest.json with installed bytes first.

```bash
/usr/bin/env -i PATH=/usr/bin:/bin HOME=/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015 XDG_RUNTIME_DIR=/run/user/1000 /bin/sh -s <<'PARENT'
set -eu
umask 077
/usr/bin/sha256sum --check --strict --status <<'RUNNER' || exit 2
9a6ebbb0c8a6a095d16ba9277181966c16e4693937e99f23b14231ddc1414d5c  /home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/run_attest_host.sh
RUNNER
exec /bin/sh /home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/run_attest_host.sh
PARENT
```

The runner accepts zero arguments and one exact physical entry. It checks original
v3 pins, accepted build/start receipt hashes, the new attestor and five npm source files before reserving
`attempt-host-v2-01`. It refuses both old and new runtime receipts. A failed or lost
request keeps its reservation. Inspect that exact invocation; do not erase or retry.
The fixed unit is `openplan-current-project-preview-app-21510042e-v3-attest-host-v2-01.service`.

The trusted host observer runs directly under systemd with 512 MiB, zero swap,
CPU 50 percent, UMask 0077, env-i and Python -B. It retains ordinary same-user
filesystem, Docker, proc and network authority. Caps do not provide confinement.
Host tools, loader, user manager and sole same-user custody remain assumptions.
The actual npm inner read-only wrapper stays unchanged. No host protection changes.

The new static attestor imports the original hash-bound v3 binding module at its
original path. It derives the exact npm PATH from fixed APP, original trusted
PATH and five pinned installed sources. All other original function guards stay.
The exclusive fsynced receipt goes only to `/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/runtime-start-attestation.json`.
It binds its own source, binding/npm hashes, derived PATH digest and original
accepted build/start receipt hashes. The original v3 receipt stays absent.

Preserve web invocation `34615ba06b554482b0f79c90fe999a61`, listener acquisition
from ss, full sealed environment, all non-cache bytes and source/global/Storage
readiness checks. Record actual exit, invocation and receipt hash privately. No
credential-bearing environment values or native queries belong in public output.
A successful unit request alone is insufficient. Keep all failures and earlier
packets. V3 runtime caches may naturally write; they are not frozen.

Do not run a new build, source capture, helper recovery, restart or browser
journey. Do not run separate SQL/database/helper commands. The reviewed attestor
reacquires its original read-only readiness and source/global/Storage boundaries
internally after review. After actual attestation,
desktop/390px navigation, console, login/decryption, artifacts, native Excel,
practitioner/public, scientific and production-capacity evidence remain separate.
