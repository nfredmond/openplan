# V3 build succeeds; the wrapped attestor cannot read the listener PID

The new v3 production build completes successfully at exact application source
`21510042e94bcaf80f262205ad156a7bb639e35c`. The controller accepts build
`u1jUSo57HKk72eLd1Qv43` and writes a fresh complete inventory. This is a new
checkout and build. The failed v2 checkout and its partial output remain retained.

## Reviewed admission and actual operations

The parent reads the complete [round-three independent review](../2026-10-15-current-project-preview-v3-independent-round3/REVIEW.md),
commit `b3ef5fd0ef3e30cfd556c1fa44971f5a865f8fca`. It finds no unresolved P1 or
P2 issue within its source and stand-in scope. Its conclusions do not establish
operational acceptance. The reviewed packet is
`a968f2ec4ed6dd018b82fe09c4d6558c16a4dca3`.

Fresh parent comparisons bind the external manifest, installed templates,
runner, checksum list and sealed inputs. The new candidate is absent and its
execution directory is empty at admission. The host has about 17 GiB available
memory and 20 GiB free disk. The running user-unit inventory shows no other QA
or build job. Existing previews and the demo remain untouched.

| Actual stage | Exit | Elapsed seconds | Memory observation | Swap |
| --- | --- | --- | --- | --- |
| Active check | 0 | 10.672 | 152.5M, rounded systemd output | 0B |
| Checkout | 0 | 29.982 | 512M, rounded systemd output | 0B |
| Build controller | 0 | 533.991 | 6,637,461,504 bytes | 0 |

Active-check and checkout event counters are absent from the parent's readback.
Their rounded peaks do not establish zero memory events. The build receipt does
record all memory-event counters at zero before and after. Its memory limit is
10 GiB, swap limit zero, CPU quota 50 percent and Node heap 6 GiB.
The actual npm build takes 509.408 seconds. Controller CPU time is 256.556 seconds.

The one-shot build unit is
`openplan-current-project-preview-app-21510042e-v3-build.service`, invocation
`2f7b863d8a5f4ef9b0efb44be5aebfbb`. The parent reads its completed command,
exit zero. The shared compiler-repair flock serializes the build. The sole
read-only observer checks the same completed job; it starts no second job.

The controller writes its accepted result after npm succeeds, resource guards
pass, application inputs still match, actual readiness and original preservation
checks pass again, and the complete `.next` inventory is acquired. An npm exit
alone would not satisfy those conditions. The inventory digest is
`fe3a11d7cf20e11e927f3e2c8ca04d37db1121fe2d0815c5ab1b4c9cf78dab55`.
[Evidence](evidence.json) retains the accepted receipt and hashes of the actual
build-exit, inventory, result and BUILD_ID files.

Application source, the complete sealed environment hash, 419 migration bytes,
dependency binding, active REST receipt and immutable source anchor retain their
reviewed identities. The helper stays at 06a. Health migration expectations
describe build metadata, not a live database census. Managed ingestion remains
disabled. No hosted setting, provider, migration, mainline merge or release changes.

## Remaining runtime and journey evidence

The observer confirms the 2,587-file inventory and all retained input identities.
Its harmless in-memory receipt control survives. Wrong head, build ID, inventory
digest and file hash each fail the named check. Live receipt hashes stay unchanged.
The observer retains exact-invocation journal accounting because systemd releases
the transient build unit before its final sample. Unavailable I/O counters remain
unavailable. Its summary is bound in the evidence file.

The parent starts the reviewed web unit once, invocation
`34615ba06b554482b0f79c90fe999a61`. HTTP health returns 200 with `21510042e94b`
and the expected migration metadata. This establishes readiness, not strict
runtime identity. The actual attestor then exits one at `attest-listener-pid`,
invocation `be8cba835bbe4c14af8ed007cd61bbb2`, after 13.653 seconds. It writes
no runtime attestation. The failed invocation remains retained.

[Read-only context diagnosis](attestation-context-diagnosis.json) reproduces the
problem with the same socket and process. Host `ss` reports one listener PID,
4104299, in the expected web cgroup and application cwd. Inside the same outer
wrapper, `ss` omits its process details. Reading its environment returns
`PermissionError`, errno 13. The wrapper has a different user namespace while
retaining the host PID and network namespaces. No host protection setting changes.
The diagnostic publishes an environment hash, never environment values.

The next bounded correction prepares a separately reviewed host-context runner
for the unchanged strict attestor. It must keep the listener/process/environment/
build checks, avoid another build or web start, and preserve the original v3
runner, failed attempt and all earlier artifacts. Host-context execution requires
an explicit trusted-controller boundary; resource caps do not supply confinement.
No runtime identity or browser acceptance follows from this diagnosis.

The [earlier failed build](../2026-10-15-current-project-preview-parent-operation/FAILED_BUILD.md)
and both full-compiler attempts remain unchanged. The successful compiler and
this build do not establish rendered maps, desktop or 390px navigation, console
quality, login or decryption, usable downloaded artifacts, native Excel behavior,
practitioner/public acceptance, scientific validity or production capacity.
T3 capture remains unresolved until a new actual journey demonstrates otherwise.
