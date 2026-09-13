# M9b response correction and publication history

This investigation follows the v0.55.2 complete-read repair. It does not change
that release candidate's runtime or claim response history already exists.
Candidate commit 3455207b5723c6394ff95b9fbbd274c79e7d3c36 is pushed directly to
main. Final CI 34735821419 and RLS 34735821475 were still running when this
note was prepared. Upgrade Path 34735821483 completed successfully. Tag that
exact candidate only after its remaining checks succeed; do not duplicate runs.

## Current observed boundary

The PATCH route at openplan/src/app/api/engagement/campaigns/[campaignId]/closeloop/
[entryId]/route.ts scopes updates by campaign and response ID but accepts no
expected revision. Its publish transition first reads status separately, then
updates and queues notifications. The race in those two operations is a code
finding, not a reproduced double-email claim.

The applied database has publication, timestamp and translation-cleanup triggers
on engagement_closeloop_entries, but no response history trigger. Existing
engagement_item_history and engagement_survey_review_history retain contribution
and survey reviews. They do not retain response corrections. Existing report
jobs freeze selected published response copies at report creation, which is a
separate record and does not establish per-edit history.

m9b-response-write-gap.sql ran in one rolled-back transaction on the explicitly
named disposable stack openplan-restore-target-2026091050. Under the real synthetic
staff identity, two ID/campaign-scoped updates both succeeded; the second replaced
the first correction without checking the editor's original version. This is a
sequential stale-editor reproduction of the route's write shape, not concurrent
HTTP or browser mutation evidence. After rollback, the real HTTP loader returned
all 1005 responses with exactly the original browser hash. No fixture was deleted
or permanently edited. The retained log and custody receipt record both facts.

## Extend the existing workflow

Keep responses in Engagement and links in existing project decisions/commitments.
Reuse contribution/survey immutable history, exact-review and report snapshot
patterns. Do not introduce a new module. The current read snapshot remains useful
but cannot substitute for retained historical copies.

The next coherent increment needs retained original/before/after copies with
actor, reason and explicit publication transition; legacy baselines must state
that earlier overwritten text is unknown. Editors must save against the version
they actually saw. Stale updates need a visible conflict/reload path that keeps
the unsaved correction. Repeated identical requests need a durable receipt;
changed-payload retries must conflict, and a replay must not rebroadcast an update.
A withdrawal must preserve the old response and its private history rather than
silently delete it. History must be reachable from the actual response card.

Preserve the existing source-publication guard in
20260908000003_engagement_public_copy_guards.sql. Editing a linked contribution
currently withdraws published responses automatically; a new response-write guard
must keep that protection and record the automatic event honestly. Do not require
an invented human reason or fresh browser version for that trusted source change.
Private old text, actor details and draft history must not enter public readers or
public exports. Historical source/configuration and approved record links must
retain their meaning when current categories or response text change.

Before implementation, settle the smallest consistent schema and withdrawal
behavior against current create/PATCH/DELETE producers, publication side effects,
report snapshots and translation custody. Test the joins, not just the new table.
Use isolated migration/upgrade, stale and concurrent writers, interrupted identical
and mismatched retries, source invalidation, outsider/viewer/public history denial,
legacy and deletion custody, and actual desktop/390px keyboard conflict/history
journeys. Every changed guard needs a harmless control and targeted failure.
Do not touch the pending reminder constraint. Continue the full roadmap after
this increment; no human review gates or scientific claim promotions.
