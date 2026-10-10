# Operator instruction reconciliation

This documentation checkpoint follows application candidate `283c20699` while
its GitHub checks run. It changes no application source, migration, test or
scientific artifact. The candidate remains unpublished.

Source review finds that the maintained runbook still describes started model
work as vulnerable to timestamp-only reaping. Migration 22 now refuses running,
attempt-managed and previously started work. The TypeScript reconciler still
selects candidates and calls that guarded database function, including during
model-page reads. The revised runbook preserves that distinction.

The two model deployment guides also predate migration 23's available
abandonment review. The database function checks owner/admin membership and
the exact reviewed state, saves prior run/stage/attempt records, revokes write
authority and returns explicit false values for process termination verification,
continuation authorization and resumed computation. The browser panel retains
the request before sending, provides exact retry and requires server confirmation
after restoration. The instructions now describe those actual controls while
keeping full continuation unfinished.

The new [upgrade guide](../../../openplan/docs/ops/V068_UPGRADE.md) collects
the 399-migration inventory, worker stopping boundary, durable journal and
installation identity requirements, explicit recovery controls and scheduled
GTFS cleanup limits. Its claims are checked against migrations 18, 22 through 27,
the current model recovery panel, model reaper and GTFS scheduled route, and the
retained integration and mobile acceptance reports. The endpoint counters still
describe abandoned ingests, not deleted cleanup objects.

All local Markdown file targets in the five edited/new operator documents
resolve, the migration directory contains 399 SQL files, and `git diff --check`
passes. No new test is warranted for this prose-only change. This is source and
evidence reconciliation, not another installation rehearsal. The populated
upgrade, full-archive restore and current-head CI remain separate evidence;
complete clean-machine agency commissioning remains unfinished.

## Accumulated changelog reconciliation

The candidate changelog now links the upgrade guide and distinguishes execution
enrollment from the still-disabled managed-attempt dispatcher. Stale statements
that no application database was upgraded and that all recovery browser evidence
remained pending are replaced with links to the dated, bounded evidence. The
original reports remain unchanged. Older release sections remain byte-identical.
The candidate heading and unpublished status remain until final release checks
succeed. No scientific grade, jurisdiction coverage or complete recovery claim
is advanced.

The reconciled changelog passes the six existing release-ordering tests. The
115 local file links across the full changelog, upgrade guide and this report
resolve; this check does not validate remote URLs or Markdown fragment anchors.
The historical changelog from v0.67.0 onward is byte-identical. Product direction
checking passes with the existing age and intervening-change reminders. No
tests or guards are changed.
