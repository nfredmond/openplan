# Frozen plan context and simultaneous save/freeze checks

This M1 checkpoint follows `473fae40`. It preserves plan-owned context in a
frozen version. It does not complete plan creation, the staff editor, amendment
carry-forward, visible public presentation or the complete freeze transaction.

## Saved behavior

The snapshot builder reads the plan context through the authenticated client,
scoped to both plan and workspace. It verifies that the current working version,
checklist and plan kind still agree with the assembly request. Missing fields,
malformed or normalized retained values and inconsistent context hashes remain
failures. Historical null becomes an explicit null in a newly assembled snapshot.
The complete saved context, including study geometry, assessment, attribution
and timestamp, participates in the version content hash.

Public review and adopted-packet readers validate retained context without
substituting later draft values. Historical absence remains usable and explicit.
A malformed or normalization-dependent value is refused even when the stored
hash matches those malformed bytes. Adoption records include the reviewed
context and a `frozen` or `not_retained` custody status. Publication also refuses
malformed retained context. No historical version or published fixture is
backfilled.

The existing public packet already carries the raw frozen content. This change
preserves the context in that data; it does not yet provide the reader interface,
map, export presentation or accessibility evidence needed to make it usable.

## Engineering evidence

- 181 land-use unit/component checks pass in 14 suites. The native persistence
  suite remains separately gated and is skipped in that ordinary run.
- Full TypeScript checking and changed-file ESLint pass.
- [Controls](context-snapshot/controls.json) retain one harmless change and 12
  faults. Each fault fails its intended assertion. The
  [runner](context-snapshot/controls.py) restores source bytes after every case.
  These checks cover projections, snapshot inclusion, scope/identity checks,
  malformed retained values and adoption custody. They do not exercise live RLS,
  concurrent route requests or a rendered workflow.
- [Native concurrency results](context-snapshot/concurrency.json) exercise the
  installed `20261016000002` functions on the named isolated verification stack.
  No candidate DDL is reapplied. Two real synthetic plans exercise opposite
  transaction order. When a context save owns the version lock first, the freeze
  waits; after the save commits, its stale context fails with `PT409`. A rebuild
  with current context succeeds. When the freeze owns the lock first, the save
  fails while busy and again after freeze because the version is no longer
  working. Frozen context remains unchanged.
- The same cases pass in a private table/function copy with a harmless comment.
  Removing the save's working-version lock and the freeze's parent-plan lock in
  that private copy permits a stale context to freeze beside a later committed
  save. That expected defect demonstrates sensitivity to the concurrency hazard.
  The public functions remain unchanged and the private schema is removed.
- The [probe source](context-snapshot/concurrency.py) refuses an existing journal
  before creating fixtures. The [repeat control](context-snapshot/journal-control.json)
  confirms the original record stays unchanged. The two real synthetic plans
  remain for audit. Their deliberately minimal SQL snapshots and arbitrary test
  content hashes are not complete authored or accepted planning artifacts.

## Open freeze transaction

The existing route updates the version, clears the working pointer and inserts
its review event in separate requests. Context consistency is protected by the
installed trigger, but these three writes are not atomic. It also returns a
server error for a trigger conflict instead of a recoverable conflict response.
The concurrency probe does not close either issue.

The next change must lock the plan and working version consistently, verify
current writer membership, and commit the version, pointer and event together.
It must preserve the exact assembled content and recheck readiness against the
content being frozen. Concurrent authored-content, process and consultation
changes need their own checks; context-only concurrency cannot substitute for
those boundaries. An uncertain HTTP reply needs exact recovery without creating
another event or freezing a replacement draft. Agent writes require the existing
action registry or an executable refusal.

M1 and v1 remain open. No production-build journey, rendered desktop/390px
inspection, keyboard/console review, practicing-planner observation, counsel
acceptance or release is claimed by this checkpoint.
