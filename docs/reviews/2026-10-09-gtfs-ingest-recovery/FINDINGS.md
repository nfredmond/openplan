# GTFS stale cleanup can destroy a completed version

Observed October 9, 2026 against `2de610b2b91d3aaafa8f7a92c7edad4348aa00e5`.
This is a reproduced recovery defect, not a completed repair or release claim.

`reapAbandonedGtfsIngests` in `openplan/src/lib/gtfs/persist.ts` selects
nonterminal versions older than fifteen minutes. It then calls
`failGtfsFeedVersion` using the retained IDs. That function deletes derived
route and stop rows before updating version status, without rechecking the
selected status or timestamp. An ingest can finish between selection and cleanup.

A production TypeScript call with a simulated HTTP interleaving issued both
deletes and a failed-status update after the simulated version became ready.
The retained SQL reproduction then exercises that statement sequence against
native PostgreSQL with current schema constraints. It inserts a synthetic stale
version, retains the scan, writes its derived rows, makes it ready and promotes
it through the existing database function. Resuming the cleanup deletes both
rows and leaves this contradictory record:

- Feed status: `ready`.
- Current pointer: the same version; its `is_current` flag remains true.
- Version status: `failed`.
- Derived route and stop row counts: both zero.

Every native fixture runs inside a transaction that rolls back. The isolated
clone has the full source schema; no acceptance database or real feed was
changed. `counterexample-controls.json` records baseline, harmless comment,
omitted route deletion and restored-source outcomes. Removing the route deletion
fails the named counterexample assertion. This verifies sensitivity to the
reported lost-row behavior. It is a characterization of the old defect, not a
regression gate requiring future code to preserve the defect.

Run on an explicitly prepared disposable clone:

```sh
python3 docs/reviews/2026-10-09-gtfs-ingest-recovery/verify_counterexample.py /path/to/config.json
```

The JSON configuration names `container` and `database`; the verifier refuses
database names outside `openplan_gtfs_recovery_<32 hex characters>`.

## Repair boundary

Cleanup must serialize with completion and promotion, recheck eligibility before
deleting anything, and report whether it actually claimed a stale version.
Changing only the final status update does not protect derived rows. A separate
read immediately before deletion still leaves a race. Worker migration must
also fence late writes and retain source bytes and adoption decisions.

The current fifteen-minute abandonment argument relies on a serverless
five-minute execution ceiling. Local Node operation does not establish that
ceiling. Longer ingest support needs measured workloads and actual ownership,
liveness and interruption recovery, rather than a larger timeout alone.

## Limits

The native reproduction explicitly orders the interleaving in one transaction.
It proves the database allows the destructive statements and inconsistent final
state; it does not measure production race frequency or concurrent lock timing.
The HTTP simulation and native SQL proof are separate evidence layers. Native
execution through the complete TypeScript/PostgREST path, the repair's concurrent
controls, source-object retention, browser behavior and representative long-feed
capacity remain unverified. This finding does not complete M3 or v1.
