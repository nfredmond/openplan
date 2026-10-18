# V5 needs one preservation correction before operating execution

Fresh independent ROUND2, October 15, 2026. Verdict: **changes required**.
I find one new P2 defect and no confirmed P1 defect in this review scope.
The three original findings have executable corrections. The final preservation
path still accepts stopped or paused protected helpers. This report does not
authorize any operating stage. Its commit must not become an approval token.

The subject is `e33ad511e1e98f9ee4cfa59a32d13f23ef1debcc`, directory
`docs/reviews/2026-10-15-portfolio-skip-preview-v5-corrections`, private root
`/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5`.
I independently match manifest SHA-256
`5122add2ac35f95851ca8b6138be6c450ebcb50d6dba48582d5179394965ae9d`
and operation-files SHA-256
`88763144a835d0ef84df3c746ca92708fe39206df0acb7db34f194a8864dd7db`.

## N1, P2: final preservation accepts an inactive old helper

Locations in the subject directory:

- `templates/helper.py:425`, preflight checks `State.Running` before baseline capture.
- `templates/helper.py:428`, that baseline retains a configuration digest.
- `templates/helper.py:376`, later acquisitions compare that digest without runtime state.
- `templates/helper.py:501`, post-journey consumes the incomplete preservation result.
- `templates/helper.py:276`, `verify_services` checks the new helpers, not the old ones.

Preflight requires each original active helper to report `State.Running=true`.
It then hashes only `Id`, `Name`, `Image`, `Config`, `HostConfig` and `Mounts`.
Later `preserve` inspections hash those same fields. They never inspect the
protected helper's `State`. A stopped container can retain every hashed field.
A paused container can also retain them while reporting `Running=true`.

The exact final chain is `post_journey` to `unchanged_inputs` to `preserve`.
`verify_services` checks the new installation first. The old web observer checks
the old Next process, socket, invocation and environment. Neither checks that
the old Auth, REST, Storage and gateway containers still run. Both old database
snapshots can remain identical while one helper stops. The final path can reach
`write('post-journey-result.json', result)` despite loss of the required active
old preview. The same omission affects intermediate imported acquisitions.

Reproduction uses the actual copied three-function chain and real pure policy
comparisons. It supplies synthetic Docker descriptors, protected database
observations and frozen-inventory observations. All file destinations are private
stand-ins, and the result writer records calls in memory. Each helper starts
running and matches the baseline configuration digest. Changing only its
`State.Running` to false still reaches the success writer, separately for REST,
Auth, Storage and gateway. Changing only old REST's `State.Paused` to true also
reaches it. No live container is stopped or paused.

The unchanged-image control succeeds first. Changing the old REST image fails
with `protected-helper:sha256`. Protected database drift fails with
`protected-database:snapshot`, and source drift fails with `source-drift`.
Neither failed acquisition reaches the success writer. These controls show that
the reproduced acceptance is specific to omitted runtime state.

A proposed in-memory inspector requiring `Running=true` accepts the healthy
fixture and rejects the stopped fixture with `protected-active:running`.
Removing that detector restores the incorrect success. This proposed guard
alone does not cover pause or restart. It supplies no implementation change.

Recommended correction: version the preparation and enforce active runtime
state for the exact helper IDs captured as active at preflight. Require running,
unpaused and non-restarting state at each protected acquisition, including the
final one. Retain the existing exact configuration comparison. If unchanged
process continuity is claimed, bind the appropriate original process/start
identity separately. Do not require historical retired helper IDs to become
running. Add harmless, stopped, paused and removed-guard controls through the
full final composition. Do not restart an old helper as a review side effect.

## R1 resolves the imported bus and namespace failure

`protected_web` pins the transport's complete file hash and private mode, creates
a new 64-hex nonce, and invokes fixed Python with a clean environment. The
transport supplies fixed UID-1000 bus variables and one fixed observer command
through the user manager. Its sole argument is the nonce. No argument selects a
command, target, script path, database or provider.

The observer requires host user namespace `user:[4026531837]`, UID 1000, the
immutable old receipt, old invocation `34615ba06b554482b0f79c90fe999a61`, listener
PID `4104299`, exact socket, cwd, cgroup and complete environment digest. It checks
actual memory, swap, CPU and memory-event values. Transport validation checks the
nonce, observer hash, identities, environment digest and resources before
returning success. Fresh stdout supplies each observation. Saved receipt files
are diagnostics, not success inputs. Failure diagnostics use exclusive fsynced
files. Process environment values remain private.

I validate all four saved context observations against their eight caller and
transport receipts. Their requests differ. All four record cleared caller bus
variables and different caller/observer user namespaces. Both second observations
bind the current composition source and report EROFS on the V4 seal and donor
package write-open specimens. The first pair records its earlier source hash;
the current composition source adds the EROFS probes. I do not treat the first
pair as execution of the later source. No context unit is rerun here.

The composition fixture uses actual cleared application and attestor mains and
the actual fixed observer transport. Future DB/helper inputs are stand-ins. The
attestor body stops at acquisition because no new runtime exists. This evidence
addresses R1's specific boundary, not complete future stage compatibility.
The outer read-only wrapper and clean npm environment remain in the reviewed
runner. The host observer does not weaken those code paths.

R1 is resolved within that boundary. The same-user code, Python/loader/tools,
user manager, bus and control plane remain trusted. The bus permits more than
this fixed transport exposes. Resource limits do not make it a hostile-host
security broker. No port-only or stale-boolean replacement appears.

## R2 adds the missing final path, with N1 still open

The new `post_journey` function calls new-helper verification, source acquisition
and protected acquisition before its append-only result writer. It requires a
private original baseline and the complete protected database set. It excludes
the new preview database, where browser login and import writes are intentional.
Its result records source/preservation digests, the fresh old-web observation,
helper identities and baseline hash. It does not claim browser success.

The literal parent script dispatches one named stage per call and explicitly
provides `post-journey`. It pins the runner and checksum list, uses the shared
lock, preserves review admission and checks predecessor receipt presence. It
does not automatically run a sequence. Its full-commit check establishes syntax
and object existence, not acceptance of that review. The inherited runner also
reserves each request before dispatch, retaining failed or uncertain attempts.

The original R2 omission is corrected. N1 prevents accepting the broader final
active-preview preservation claim. My composed controls exercise source and
protected-database refusals as well as the stopped-helper survivors. The prior
64 selected observations remain attributable to their own drivers and fixtures.
They do not test the omitted old-helper runtime state.

## R3 rejects a weak first receipt before publication

Both full CHECK strings are fixed in sealed `expected-checks.json`, bound to
candidate SHA-256 `b129f80e37aa9be71069683acd42df3fb6fdb94078ed0458f20b6e9c5155a41b`.
Their decision operator, OR, column names and ordered allowlists match the
candidate SQL on inspection. The new `upgraded` consumer compares both complete
strings before the initial upgrade receipt can publish. `upgrade_ready` calls
that consumer before comparing the fresh state with the original receipt.

My independent copied consumer accepts a harmless observation note and rejects
both phrase-preserving `CHECK ((decision <> 'create'::text) OR true)` specimens.
A matching weak first receipt also fails. I read the author's allowlist,
operator, null, missing, normalization and removed-comparison controls. Their
harmless specimens and named failures address the original substring defect.

R3 is resolved as an oracle-design defect. No actual PostgreSQL parsing or
normalization runs here. Different PostgreSQL-17 deparsing must fail closed and
retain the mismatch for review. Do not recapture the target as a replacement
oracle. A successful future migration transaction would precede this readback;
failure here does not imply rollback of a transaction already committed.

## Custody, execution and remaining boundaries

The assigned clean branch fast-forwards locally from `05dd3e8` to the authorized
subject. The application subtree equals exact APP49
`49e3fa2004c1336ffa36c134a8f21bcc2d72d327`. I read current AGENTS, shared
coordination, the prior full review, the full V5 STATUS and recipe, literal
shell, five diffs, seven assembled runtime files, expected checks, control
drivers/results, composition source, raw receipts, audit/seals and private
bindings. Planner-writing, prove-it and the Supabase/Postgres guidance apply.
This assigned review selects no product lane and repeats no direction campaign.
There is no nested delegation or browser work.

The [source bindings](source-bindings.json) pin all 36 subject files and the prior
review inputs. All 30 sealed inputs and their file modes match. The seven assembled runtime
files match the private packet, and all five diffs regenerate exactly. Binding
consumers validate private configuration without printing secrets. Inherited app
environment, role-URI and candidate custody remain as supplied. The preparation
audit's 51,233-entry preservation result is existing evidence. I inspect its
bindings without repeating that old-root campaign. My controls independently
check that all 74 existing private files remain byte/mode identical.
The final bounded readback also matches the retained original dump's exact
16,232,305 bytes and fixed hash, role URIs and retained failed-driver hashes.
Its known-secret and typography screen accepts harmless text, detects in-memory
injections and exposes a disabled scanner. It does not prove unknown-secret absence.

[Independent controls](review_controls.py) and [results](controls.json) retain
22 observations: 11 survivors and 11 named refusals. Six survivors deliberately
expose N1, including removal of the proposed detector. They are findings, not
acceptance. Stand-ins replace Docker, database, HTTP, host observation and final
write effects. [Execution records](execution.json) retain both successful bounded
control runs. The final run reports 68.3M rounded peak and zero swap. Missing
event counters and the collected unit's unavailable properties are not inferred
as zero or current resource evidence. All runs request 512 MiB, zero swap,
50 percent CPU, shared flock, private HOME/cache and disabled Python bytecode.

The author's missing-key, AST-format and scanner failures remain retained and
supply no pass. No V5 operating stage runs. Candidate/runtime/result artifacts
remain absent and the V5 execution directory stays empty. This review writes
only its report directory and new private proof root
`/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v5-independent-round2-20261015-78ca8e4a`.
The review is committed locally only, without push or PR.

No live DB/Docker/HTTP observation establishes present preservation here. Logical
snapshots cannot establish continuous service availability, and file hashes
cannot establish running state. Existing context receipts do not prove hostile
host confinement or fresh new-runtime identity. Restore/upgrade, helper readiness,
fresh 420 build, strict new runtime attestation, normal desktop/390px import,
console, downloads/artifacts and final preservation acquisition remain pending.
The earlier native proof, 395-record repeat, initial unattributed catalog change,
grant warning and full compiler receipt remain supplied historical evidence.
Practitioner/public, native workbook, scientific, whole-installation recovery
and production acceptance remain unproved.
