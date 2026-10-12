# Private original aerial dispatch custody remains a candidate

## Latest checkpoint

The helper now passes 34 tests and 43 control cases, including complete v1.1
photo manifests, nullable projects and static refusals for thrown transport
errors. The route controller passes 25 tests and 16 control cases, including
original signed-photo custody, pending receipt ordering and uncertain reads.
Source restores exactly. [Final combined tests and scoped checks](evidence/final-checks.json)
pass after the transport and manifest additions: 59 tests, scoped TypeScript and
changed-file lint. The [source bindings](evidence/source-bindings.json) identify
the checked application code, candidate migration and public proof runners.

Expanded native SQL passes 73 observations and 32 cases: three baseline,
harmless and restored survivors and 29 intended failures. The first expanded
controller refuses a wrongly selected expected assertion. Removing the project
comparison first exposes the earlier actual project-deletion probe, rather than
the later corrupted-projection probe. The corrected selection retains both
probes. No predicate is weakened. The [failure oracle](verify_failure_oracle.py)
passes 13 cases; its stronger classifier also rechecks all 29 retained real
failure diagnostics and rejects unrelated SQL or additional assertion failures.

[Concurrent parent locking](native_parent_locks.py) passes four actual cases.
Project deletion finishes while admission waits on that parent. Moving the
initial job lock before its parent causes the intended native deadlock. The
baseline, harmless and restored cases refuse the changed parent. Four fresh
database clones remain retained; this proves the tested project path only.

[Complete candidate replay and restore](native_restore.py) passes four cases.
Each starts from the selected 405-version pre-candidate main dump and applies
the complete candidate SQL with a manual 406-version history record. Three
cases independently dump and restore original receipts, schema, permissions and
private row data. Changing the generated digest to MD5 fails the original
SHA-256 check. The first restore trial uses a role that cannot set the Auth
schema owner. It fails and remains retained; the corrected runner uses the
captured cluster's bootstrap administrator. All native containers and controlling
services stop. This is one local cluster, not CLI, offsite, Storage/worker,
physical-host, hosted or full installation recovery acceptance.

PR #205 now has all seven required exact-head GitHub checks passing. The shared
file records later autonomous merge and migration directions. This owner takes
an available coordinated turn only after the current main deployment finishes,
with a dated line before each merge and health verification afterward. Candidate
slot 03 still needs its recorded rollout plan, fresh database/Storage capture
and confirmed application before dependent code. No hosted apply or merge has
occurred from this lane.

The isolated branch `work/odm-private-dispatch-producer-20261011` continues above
PR #241 at `0914762954983d4efc0d8a1b0092ea91d5e479a0`. The [design](DESIGN.md)
preserves exact original text privately and separates current access observations
from engine permission. No hosted migration, main merge or default worker
activation has occurred in this lane.

The optional process-route hook saves and validates the original before dispatch,
then reads current scope. Failed or uncertain custody and revoked scope refuse
external work. The legacy default continues to send the existing serialized
contract. No browser or planner acceptance is claimed by this backend connection.

## Earlier checkpoints

The first helper run passes 29 tests. The later helper run adds the read error
case and strengthens the byte-bound probe. Its [controller](verify_controls.py)
passes 37 cases, including baseline, harmless and restored survivors. It restores
exact source bytes. Two controller trials remain failed and retained: the first
mutant raised a configuration error before its intended assertion; the second
assumed Vitest always prefixes an assertion with `AssertionError`. The accepted
controller checks the selected assertion and known Vitest assertion formats.

The first combined helper and route run passes 52 tests. Two more route tests
then check a pending storage receipt and uncertain current read. The
[route controller](verify_route_controls.py) passes 15 cases against all 24 route
tests. Its first run refuses an ambiguous membership-projection mutation target
because GET and POST both select `role`. The corrected target changes only POST.
That failed trial remains retained. Exact route bytes restore in `finally`.

The isolated native fixture starts from a retained 399-migration predecessor,
then applies six committed main migrations as explicit SQL transactions and
records the resulting 405-version history. A fresh local dump precedes the
candidate. This is a manual SQL upgrade, not a Supabase CLI upgrade or hosted
rollout. The source predecessor remains a historical fixture, not current main.

The first full candidate attempt fails PostgreSQL's generated-expression
immutability rule. The next fails the CASE expression's PL/pgSQL parsing. Both
transactions roll back and their owned containers stop. The corrected text
digest and parenthesized expression apply. A real service-role probe then exposes
the missing Auth table permission; the narrow private helpers resolve that need.

The first role fixture attempts to demote its sole owner and correctly fails the
existing owner floor. The next account-deletion probe encounters the same floor
in the new actor's automatically created private workspace. The corrected
synthetic fixture retains a separate owner and retires that actor's own private
workspace before account deletion. This does not establish general account
deletion usability. Failed observations remain retained.

The initial corrected native run passed 54 observations for actual SQL roles, exact
bytes, immutable replay, current access, active and terminal states, changed
parents and nullable projects. It uses a one-GiB database container with no
network or published ports. Its controlling service stopped. Expanded projection
and scope controls later passed through [native_database.py](native_database.py)
and [verify_native_controls.py](verify_native_controls.py), as recorded above.

## Remaining work

Complete remaining snapshot/parent paths, actual RPC transport and CLI upgrade
verification. Combined tests, scoped TypeScript and changed-file lint pass.
Documentation checks pass for the candidate; exact-commit CI remains separate.
Connect an independently verified private worker
reader before enabling the managed aerial pipeline.

Current access reads do not fence an external engine request. Worker attestation,
processing commit reconciliation, reconstruction, result publication, callback
recovery, full installation recovery, hosted operation, capacity, desktop/390px
journeys, practitioner acceptance and scientific validity remain open.

The shared coordination file governs merge turns and hosted rollout plans.
PR #205 follows the latest coordinated merge-turn rules. Its seven required
combined-head checks pass, including live RLS. The general hold remains lifted.
A passing push is not a release.
