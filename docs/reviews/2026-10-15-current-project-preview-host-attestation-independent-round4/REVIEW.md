# Round four clears the bounded host-context and exact npm PATH correction

Reviewed October 15, 2026 using GPT-6.1 Sol at high reasoning. No delegation.

**No current concrete unresolved P1 or P2 finding remains within this bounded
source, fixture and composition review.** The new runner addresses host process
visibility, and the new attestor derives npm's exact PATH without weakening the
other environment comparisons. This finding does not establish actual runtime
attestation, readiness, product acceptance or release. Parent retains sole actual
operation ownership and must use the new recipe once after its fresh readback.

## Exact subjects and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-da10ddc3`,
initial branch `t3/da10ddc3`, final branch
`t3/preview-host-attestation-review-round4`. The branch name changes during the
review; the final Git readback establishes the latter name. It starts clean at
`05dd3e8da4a4572437f06e771b0a2477873e681f` and fast-forwards locally to
`f25d91bece7259c5013136873c97a784ea562069`, resolved in `t3-e33fc359`.
No fetch or parent edit occurs. The live T3 inventory shows this child and its
parent running. Ownership covers this new report directory and only this private
root:

```text
/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-independent-round4-20261015
```

The exact reviewed candidate is `90cc1f800840f5921f7cf17d413af01187e39d4e`.
Parent `f25d91bec` carries the identical packet as a local cherry-pick, rather
than ancestry from `90cc1f800`. A path-scoped Git comparison has no differences.
The [evidence](evidence.json) records the manifest hash
`b5da239064c99976e8dd27c1f00f0fea66fac7c7fb085854d4160fbb4ec6a230`,
attestor hash `c9439e729583c4312c2c8b2d5e96e6981fb81d485f8a7a639f9956f1c28e3002`
and runner hash `9a6ebbb0c8a6a095d16ba9277181966c16e4693937e99f23b14231ddc1414d5c`.
Installed templates and all 21 literal external pins match the public packet.
The parent's supplied 39-check readback is context, not my independent oracle.

I read current AGENTS, planner-writing, prove-it, the relevant contract,
roadmap/capability/architecture/limitations context and October 6 direction review;
the full parent v3 operation and adjacent evidence/context diagnosis; round-three
review; first host-runner report, recipe, manifest, runner and controls; parent
PATH finding and diagnosis; and the new packet's brief, templates, diffs, manifest,
recipe, all control source and evidence. The direction check exits zero under
the required lock and caps. It retains existing registry-age, package-version
and intervening-change reminders. No queue, date, grade or product lane changes.
Full v1, fifty states/DC, California depth, territories, tribal/overlapping
authorities, independent installation, free software and scientific custody remain
binding. No hosted setting changes.

## Exact source and installed npm establish the fixed context

[audit.py](audit.py) compares the complete `attest()` AST with the original after
three explicit transformations: derive expected PATH, select the new receipt
location and add binding/npm/path provenance. It accepts harmless wording first
and rejects removed environment enforcement. Every other function statement
matches, including listener PID acquisition, cwd/cgroup, all other exact expected
environment keys, forbidden ambient keys, resources, non-cache build bytes,
HTTP identity, repeated input acquisition and exclusive fsynced writing.

The module header separately hashes the original binding before import, then
checks its resolved file and hash. `main()` preserves environment clearing and
makes the new file identity explicit. No actual module is patched. The binding's
`write_once()` retains O_EXCL, O_NOFOLLOW, file fsync and directory fsync. The new
receipt retains original build/start receipt hashes and adds the new source,
original binding, five npm sources and derived PATH digest. It cannot certify
future loader or hostile same-user behavior.

I inspect installed `run.js`, `run-script.js`, `run-script-pkg.js`,
`make-spawn-args.js` and `set-path.js`. This `npm run start` call supplies no
binPaths; the package helper defaults it to false and passes that value through.
The launcher supplies one trusted PATH and the fixed APP cwd. The Linux algorithm
walks every APP ancestor through `/`, appends npm's fixed node-gyp-bin directory,
then `/usr/bin:/bin`. It does not copy observed PATH, omit the key or compare a
prefix. The five literal hashes pin that inspected implementation.

[function.py](function.py) executes both actual installed npm helpers without
npm dispatch or a child script. Both match the Python derivation for the fixed
real APP, digest `ad753e22e76a38f64d18b5e4eceb9ce3d5ff73e58c7e0ef9b4b9e119566b794a`.
Its parity oracle accepts harmless metadata first and rejects a changed spawn
PATH. Pinned source inspection establishes the upstream context; this helper
execution does not establish actual startup.

## Selected actual-function tests detect the relevant broken behavior

Thirteen fresh observations execute the actual attestor function with inspected,
relocated fixture builders and operational I/O adapters. They never replace
`attest()` or its enforcement. Synthetic build/start producers avoid npm and
business stages. Proc/systemd/HTTP/recovery acquisition and source/global/Storage
inputs remain synthetic. These adapters do not establish live acquisition.

Harmless source wording survives first. Exact helper PATH succeeds. Pre-npm
base-only PATH, wrong ordering, an extra entry and missing node-gyp refuse at
`attest-process-environment`. Another sealed environment value and a short process
SHA refuse there too. Wrong cwd, duplicate new receipt and wrong new file identity
refuse at their corresponding guards. Removing environment enforcement accepts
the wrong PATH and triggers `accepted-broken-behavior`; removing PATH replacement
makes the actual-helper PATH refuse. Exact source restoration succeeds.

Independent import controls reject changed original source bytes, a wrong imported
module file, a changed npm-source hash and a wrong trusted base. Removing the
preimport hash makes its original refusal oracle fail with
`accepted-broken-behavior:attest-binding-sha`. The actual installed templates stay
untouched. The candidate's broader 29-observation and six-new-guard campaigns
remain inspected prior evidence, not fresh replays or operational acceptance.

## Host composition keeps its intended authority and rejects entry faults

[composition.py](composition.py) selects nine ordinary observations and four
code-fault detections through actual POSIX shell and systemd. Adaptations replace
owned fixture roots, pins, unit names and the final payload. Every child payload
is a proc-reading stand-in with an owned, non-listening sleep peer. No real
attestor, actual fixed host unit or application stage is dispatched.

Harmless-first, parent-entry harmless-first and restored runs reach the payload.
They read peer cwd/environment, retain host user/network namespaces, and observe
512 MiB, zero swap, CPU 50 percent, UMask 0077, Python -B and a clean environment.
Caller PATH, shell-init and Python startup traps stay unused. Changed npm seal,
reserved attempt, alternate entry and either existing receipt refuse before a
unit or payload. Parent external hash rejects a changed runner before dispatch.
Removing the seal, attempt, new-receipt or parent-hash guard separately exposes
dispatch and fails the shared `dispatch-before-refusal` oracle. All modified
fixture runners and sealed bytes restore in finally blocks. Only owned peers
receive termination signals.

Static review also retains zero arguments, exact physical roots, both receipt
checks, atomic one-shot directory reservation, fixed new unit and clean interpreter.
The parent recipe starts env-i before its shell and checks the runner's external
hash before execution. It does not dispatch the old runner. The new host observer
has ordinary same-user filesystem, Docker, proc and network authority. Resource
caps do not confine it. Host tools/loader, user manager and exclusive same-user
custody remain assumptions. The actual npm inner read-only boundary and host
protections remain unchanged. Reservation is not a power-loss transaction.

All Node/composition work runs serially under
`compiler-repair-checks-20261015.lock`. Every review unit requests 512 MiB, zero
swap and CPU 50 percent. Pure check units mount the host read-only, disable networking
and allow private-root writes. Host-context composition has no outer wrapper.
Private logs and manager journals retain five exact unit/invocation identities.
Missing event accounting remains unavailable. Short fixture peaks do not establish
application capacity.

## Prior objections, failures and remaining boundaries stay visible

F1's bare npm, borrowed writable dependencies and dropped private caches remain
valid historical findings, addressed by the 807 controller/inner-boundary repair.
R1's outer/inner nesting failure remains valid; trusted direct controllers retain
the documented same-user authority. R2's full versus 12-character HTTP mismatch
remains valid; HTTP uses exactly 12 characters while process/source custody uses
40. Rounds two and three clear bounded source/stand-ins, not actual contexts.

The actual accepted v3 build and sole start remain prior parent evidence:
app `21510042e94bcaf80f262205ad156a7bb639e35c`, BUILD_ID
`u1jUSo57HKk72eLd1Qv43`, 2,587-file digest
`fe3a11d7cf20e11e927f3e2c8ca04d37db1121fe2d0815c5ab1b4c9cf78dab55`.
The original wrapped attestation still fails at `attest-listener-pid`, invocation
`be8cba835bbe4c14af8ed007cd61bbb2`. The first host runner remains unexecuted and
would next fail the pre-npm PATH comparison. Neither failure becomes a pass here.

The implementation packet retains two harness failures. Its first function
assertion incorrectly excludes the valid version field and stops before the
function campaign. Its corrected assertion checks the two contracted fields.
Its first root-guard removal reaches a stand-in that compares lexical alias and
resolved cwd. Resolving the stand-in root/HOME corrects that assay. Neither
correction changes production templates or supplies successful evidence from the
failed run. The earlier first-host relocation/export failures and round-three
failures remain retained. This round has no test setup failure or new contrary
result. The non-ancestor Git observation above reflects the documented cherry-pick.

[final.py](final.py) compares 69 selected fixed files by hash, size and mode.
They match the review-start snapshot, including original v3 code/inputs and
build/start receipts, both host templates, npm pins and relevant public records.
Harmless metadata survives; owned byte/mode faults fail and restore. Both actual
host units, both reservations and old/new receipts remain absent, including
dangling-link refusal. The original web invocation remains active and unchanged
at `34615ba06b554482b0f79c90fe999a61`. This readback sends no HTTP or database probe.

An existing original-binding Python cache is present. Python -B can read it;
read-only comparison finds its code object equals fresh compilation of the
hash-bound source. This small observation neither seals future bytecode nor
changes the host loader trust assumption. Running runtime caches remain excluded
from selected-file preservation. No complete v3-root immutability, new logical
source/global/Storage preservation or database recovery claim follows.

Known-value privacy controls accept harmless text and detect five configured
values without publishing them. Unknown secrets remain outside that screen.
Original helper 06a, source anchor 82fda300..., REST 140c6867... and managed GTFS
zero keep their sealed identities. No source recapture, recovery or clone runs.

Parent must freshly compare the exact manifest, installed templates, literal
pins, absence/reservation state and original web invocation before its one-shot
attestation. That actual function must reacquire listener/process/full environment,
non-cache build bytes, HTTP identity, resources, readiness, source/global/Storage
preservation and race boundaries, then write only the new exclusive receipt.
A failed or lost attempt stays reserved; inspect it without retry or another unit.

No actual attestation/build/start/restart, SQL/database/helper operation, provider,
browser, install, full suite, application compiler, broad/native audit, push, PR,
mainline merge or release occurs. Desktop/390px navigation, console, login and
decryption, usable artifacts, native Excel, practicing planners/public,
nationwide scientific validity, independent recovery and production capacity
remain separate unresolved evidence. This review does not change those grades.
