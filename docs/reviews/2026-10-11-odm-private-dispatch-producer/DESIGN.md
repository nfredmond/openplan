# Save original aerial requests before dispatch

Continue M3 and M5b.2 above PR #241. That candidate preserves supplied original
request bytes and job context in the owned worker runtime. This increment gives
the existing application backend a private source for those originals. It does
not enable the candidate worker pipeline or grant permission to run an engine.

The existing human-authenticated process route inserts its job before calling
the worker. Save its exact serialized request before that external call. Keep
signed photo URLs outside member-readable jobs and callback records. Bind the
private text to its SHA-256, byte length, installation, database target and
original eight-field job projection, including the actor and nullable project.
The source body, callback, title and notes remain in the saved original text.

Use an additive, unexposed schema. The backend role can insert and read originals
but cannot update or delete them directly. A repeated record operation accepts
only identical text and scope. Parent job deletion can cascade; a missing record
must refuse recovery. Database administrators retain their administrative power.
This schema does not claim to prevent a trusted backend or administrator from
forging records through direct SQL access.

Keep public RPCs as invoker functions with a fixed search path and service-only
execution. The backend role cannot directly read or lock Auth users. Two narrow
definer helpers in the unexposed schema check one actor's existence and retain
its deletion lock. They also have a fixed search path and service-only execution.
Do not expose this schema through the Data API.

Admission locks the actor, workspace, project, mission and membership before
the job. It requires a current owner, administrator or member, the original
requesting actor, a requested job and matching workspace/project/mission scope.
Membership admission uses `NOWAIT` because owner-floor revocation locks the
member before its workspace. Mission and job admission also use `NOWAIT`:
their writes update the project's evidence revision after locking that child.
An already held row produces a contention refusal instead of a lock cycle.
After acquiring these rows, admission compares the current eight-field job
snapshot with its initial read. A changed or missing job refuses before custody.
The database checks wire version and scope; the TypeScript producer validates
the complete existing request contract. The worker still independently validates
its incoming contract. No new fields enter that public contract.

Read custody separately from current access. A read returns the immutable
original and a current access observation. Revocation, changed scope and terminal
jobs produce `authorizedNow: false`. Missing records produce a refusal. Every
receipt retains `engineTransportPermission: false`. A current read is not a
lease, durable command grant, transaction spanning an external request or worker
attestation. Atomic external revocation remains separate unfinished work.

The route connects this only with `OPENPLAN_AERIAL_DISPATCH_CUSTODY=1` and both
`OPENPLAN_AERIAL_DISPATCH_INSTALLATION_ID` and
`OPENPLAN_AERIAL_DISPATCH_TARGET_ID`. These are stable operator identities.
An absent flag or `0` keeps the existing dispatch path. Other flag values or
missing identities refuse before a job insert. Storage, reply validation or
current-read uncertainty marks the new job `dispatch_failed` and sends no
external request. Each RPC carries a ten-second abort signal. Original text
is serialized once and the external dispatch sends that same string.

Migration `20261017000003_aerial_private_dispatch_custody.sql` remains a candidate.
The CLI originally generated `20261012030417`; the shared coordination record
reserves slot 03 after the staged survey-count migration. That ordering change
does not establish application or release acceptance. A schema-dependent main
merge follows the latest dated autonomous-migration direction in the shared
coordination file. The owner records a rollout plan, takes a fresh database and
Storage capture, applies and confirms the migration before dependent code, then
verifies production health before another merge. No new paid infrastructure is
authorized by that rule.

Prove helper and route guards with harmless survivors, specific broken behavior
and exact restoration. Test real service, authenticated and anonymous PostgreSQL
roles separately. Check native parent locking, original replay, current-main
upgrade and independent restoration before enabling this path. Keep simulated
RPC tests, native SQL, HTTP integration, browser and practitioner evidence distinct.

The general main hold is lifted. The latest autonomous-merge direction permits
each owner to take a coordinated available turn. Check all unmatched deployment
entries and the current back-off agreement before taking that turn. PR #205 is
this lane's first current-main join. Prepare the reviewable implementation and
relevant local checks before starting a candidate rollout.
