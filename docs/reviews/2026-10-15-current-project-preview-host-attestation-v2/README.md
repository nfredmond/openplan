# V2 host-context attestation is prepared for independent review

Prepared October 15, 2026 with GPT-6.1 Sol at high reasoning. No delegation.
The new static attestor and fixed runner address both retained defects. This
packet supplies fixture and composition evidence, not actual runtime attestation.
One new independent round four must review both corrections before parent execution.

## Ownership and unchanged direction

The assigned clean checkout is `t3-3f9b92ea`, branch
`t3/preview-host-attestation-v2-npm-path`. It fast-forwards locally from
`05dd3e8da4a4572437f06e771b0a2477873e681f` to parent
`5c4570c9d2fedda8f7f8dd4091faf2ebdcdedf2c`, resolved in `t3-e33fc359`.
No fetch or parent edit occurs. The live T3 inventory identifies this running
implementation child and completed parent, observer and prior review tasks.
Ownership covers only this new public directory and:

```text
/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015
```

I read AGENTS, planner-writing, prove-it, product direction, the binding contract,
roadmap and relevant capability/architecture/limitations context, the full parent
v3 build/failure/context records, round-three review, first host-runner report,
recipe, runner, manifest and controls, and the parent's PATH finding and evidence.
The direction check succeeds under the shared flock, 512 MiB, zero swap and CPU
50 percent, with private caches and read-only host/network isolation. Existing
registry-age, version and intervening-change reminders remain. No review date,
queue, product lane, capability grade or scientific claim changes. Full v1,
all states/DC, California depth, territories, tribal/overlapping authorities,
free open source, independent installation and scientific custody remain binding.

## Both retained failures have bounded corrections

The accepted app remains `21510042e94bcaf80f262205ad156a7bb639e35c`, BUILD_ID
`u1jUSo57HKk72eLd1Qv43`, with 2,587-file digest
`fe3a11d7cf20e11e927f3e2c8ca04d37db1121fe2d0815c5ab1b4c9cf78dab55`.
The prior actual build records exit zero, 533.991 controller seconds, 509.408 npm
seconds, peak 6,637,461,504 bytes under 10 GiB, zero swap and recorded zero events.
Those are retained parent/observer findings, not new compiler or build runs.

The one web unit remains
`openplan-current-project-preview-app-21510042e-v3-web.service`, invocation
`34615ba06b554482b0f79c90fe999a61`. The parent observes HTTP 200 with the expected
12-character SHA and 419/latest-16 metadata. Its wrapped original attestation
fails at `attest-listener-pid`, invocation `be8cba835bbe4c14af8ed007cd61bbb2`.
The retained diagnosis finds the outer wrapper's different user namespace hides
PID details and denies the same host process environment. No host setting changes.

First host-runner commit `384314aa2f7aff8a3c0e3093f52e1d164d63f423`, joined by
`ebe69e1db`, removes that outer wrapper for the trusted observer. It remains
unexecuted and byte-preserved. Parent then finds exactly one mismatch among
22 expected environment keys, PATH. All sealed app values match. The old attestor
expects `/usr/bin:/bin`; npm's actual child has its package/ancestor bin entries
and node-gyp-bin before that trusted base. The parent correctly avoids dispatch.

[attest_start_v2.py](attest_start_v2.py) is an additive version based on the exact
original v3 source. [The unified diff](attestor-diff.patch) shows every change.
A fixed path and preimport hash bind the original app module. Its imported path
and hash are checked again. No actual module globals or functions are patched.
The production function changes only expected PATH, its new receipt target and
three provenance fields. An exact function comparison checks this limited delta.
`main()` makes the unchanged startup steps and renamed file guard directly testable.

Five literal hashes pin installed npm `run.js`, `run-script.js`,
`run-script-pkg.js`, `make-spawn-args.js` and `set-path.js`. The inspected
`npm run start` call passes no binPaths; the package helper defaults it to false.
The short Linux algorithm walks fixed APP ancestors through `/`, appends npm's
fixed node-gyp-bin directory, then the original trusted PATH. It never copies
an observed PATH, skips the key or accepts a prefix. Source hashes and the trusted
base are checked before derivation. All other expected keys retain exact equality.

Original guards remain: listener PID from ss, unit/cwd/cgroup, full sealed app
environment and forbidden ambient keys, accepted build/input identities, non-cache
build bytes, resources, actual readiness and source/global/earlier-helper/Storage
acquisition, 12-character HTTP identity with 419/latest metadata, full 40-character
process/source identities, repeated race checks and exclusive fsynced writing.
The new receipt binds attestor source, original binding, npm sources, derived PATH
digest, existing build/start receipt hashes and the original acceptance boundary.
It writes only under the new private root. The original v3 receipt stays absent.

[run_attest_host.sh](run_attest_host.sh) accepts zero arguments and one exact
physical entry. Its 21 external pins cover the original v3 admission manifest,
sealed code/inputs, accepted build inventory/result/BUILD_ID/start intent, new
attestor and npm sources. The parent checks the runner's external hash before a
clean shell starts. The shell checks pins before Python or systemd, refuses old
and new receipts, and atomically reserves one fixed new attempt directory.
[The runner diff](runner-diff.patch), [manifest](manifest.json) and
[parent recipe](PARENT_RECIPE.md) name all literal paths and hashes.

The fixed observer runs directly under systemd, 512 MiB, zero swap, CPU 50 percent,
UMask 0077, env-i and Python -B. Ordinary same-user filesystem, Docker, proc and
network authority remain. Caps do not provide confinement. Host tools/loader,
user manager and sole same-user custody remain trust assumptions. There is no
host protection change. The actual npm inner read-only wrapper remains untouched.
The attempt reservation blocks ordinary duplicate requests and lost-ack retries;
it is not a durable transaction against power loss or a hostile same-user owner.

## Controls exercise the actual function and fixed host entry

[verify_attestor.py](verify_attestor.py) executes the actual strict function with
existing synthetic producer payload and binding-consumer fixtures. It replaces
operational proc/systemd/HTTP/recovery acquisition, redirects filesystem inputs
into owned fixtures and captures receipts through the original exclusive writer.
It does not replace `attest()`. The synthetic build/start fixture producers never
invoke npm, a compiler, business service or actual application stage.

The final function campaign has 29 observations and three code-fault detections.
Harmless source wording survives first. Exact installed-helper PATH succeeds;
base-only, wrong order, extra entry, omitted package/root/node-gyp prefixes and
wrong base refuse at `attest-process-environment`. Full/short SHA, another sealed
value, ambient proxy, inactive unit, listener/PID/cwd/cgroup, swap, HTTP status/
identity, duplicate receipt, entry identity and import/npm/base faults refuse
at named guards. Every successful observation reaches the complete function.
Removing environment enforcement exposes acceptance of a wrong PATH. Two wrong
algorithms disagree with the independently executed installed helper. Restoration
returns to the exact installed new source.

[verify_new_guards.py](verify_new_guards.py) adds six code-fault detections after
its own harmless survivor. Removing preimport source, imported-module, npm hash,
trusted base or new file guards exposes the named acceptance oracle. Removing
PATH replacement makes the actual helper PATH fail the original environment
comparison. The last full function run restores the exact source.

[verify_npm_context.py](verify_npm_context.py) independently runs installed
`set-path.js` and `make-spawn-args.js` under Node. Both match the Python value for
the fixed real APP. No npm script or child script is spawned. A harmless result
field survives; a wrong PATH fails the shared parity oracle. The pinned run call
and package default establish the false binPaths context. This is not startup proof.

[verify_runner.py](verify_runner.py) records 15 ordinary observations and nine
guard-removal detections against the final runner pins. It uses actual POSIX
shell/systemd with owned fixed-root/hash/unit adapters and final stand-in payloads.
Those payloads read an owned non-listening peer's cwd/environment, retain its host
user/network namespaces, verify actual caps, Python -B and clean environment,
and publish only safe hashes/booleans. Caller PATH, shell-init and Python traps
remain unused. Only owned bounded sleep peers are terminated.

Entry/seal/args/root/receipt/attempt and parent external-hash refusals occur before
dispatch. Each relevant guard removal exposes dispatch and fails that same oracle.
Harmless first and exact-restoration compositions succeed. The final rerun follows
addition of four accepted build/start pins; it is not a replay of the old 24-case
campaign. Old native/full-suite/compiler/47/34/121/72 campaigns remain prior evidence.

All Node/composition work runs serially under the required compiler-repair flock.
Pure checks use read-only host mounts, offline networking and owned private writes.
Host-context composition has no enclosing read-only wrapper and is not described
as confined. Each unit requests 512 MiB, zero swap and CPU 50 percent. Python uses
-B; caches stay private. Missing accounting stays unavailable, never inferred zero.

Two harness failures remain private with source and manager-journal identities.
The first function assertion omits the valid deployment version field and stops
before the function campaign. The corrected assertion checks contracted fields.
The first composition removal reaches its stand-in, which compares a lexical alias
to a resolved cwd. Resolving the stand-in's own root/HOME fixes that assay. Neither
failure requires a production template change or counts as passing evidence.
The first staged whitespace check also flags five blank context prefixes in the
unified-diff artifact. The retained context diff stays private; the published
attestor diff uses zero context. Subject bytes do not change.

## Preservation and remaining proof

[final_checks.py](final_checks.py) compares 679 selected fixed files by hash, size
and mode with its starting snapshot. They remain unchanged. They include original
v3 code/inputs/build/start receipts/BUILD_ID, earlier fixed packet files, the first
host runner and parent/round-three records. Harmless metadata survives; owned
byte/mode faults are detected and restored. Exact new installed templates match
external hashes and all 21 pins. Known-value privacy checks detect five configured
values after a harmless survivor. Unknown secrets remain a blind category.

Both old/new actual host units are absent. First-host and v2-host attempt reservations and
old/new runtime receipts are absent. The original web invocation remains active.
This is selected file preservation and unit-state observation, not new logical
database/global/Storage preservation or full runtime attestation. Running v3 caches
may naturally write; no full v3 immutability claim is made. Original helper 06a,
source anchor 82fda300..., REST 140c6867... and managed GTFS zero retain their
sealed identities. No source recapture, helper recovery or database clone occurs.

No actual attestation/build/start/restart, SQL, database/helper operation, provider,
browser, install, push, PR, merge, release or nested delegation occurs. No hosted
operation changes. Source/stand-ins do not establish real readiness, transport,
full process identity or race freedom against a hostile owner. Desktop/390px,
console, login/decryption, artifacts, native Excel, practitioner/public, science
and production capacity remain unproved. T3 capture remains unresolved.

[The round-four brief](INDEPENDENT_ROUND4_BRIEF.md) preserves prior findings and
asks for one review of both corrections. Parent retains sole actual execution
ownership after that review. The recipe does not dispatch any other stage.
