# Project archives and governed approval

## Confirmed boundary error

Earlier project journeys reached their board report but remained partial at
the evidence ZIP. The visible review required a linked plan even for an
ordinary project archive. Source history shows commit `62581876` added both
that requirement and exactly one report PDF when implementing governed
decision packages. It applied them at archive creation, not just submission.

That is the wrong boundary for a project-only handoff. Creating a plan merely
to archive a corridor's evidence would invent an unnecessary planning record.
The existing ZIP builder already supports nullable plan and current-PDF fields.
The existing submission route and database independently require both for
governed approval. No new module, write path, or migration is necessary.

The full twelve-job run `2026-09-05T18-21-04-045Z` was interrupted, exit 130,
during its non-California journey. First-day setup reached an explicit yes in
199 seconds with zero findings and console errors. The interrupted and unrun
jobs remain incomplete. Earlier partial project outcomes remain unchanged.

## Correction

The same review dialog and archive route now allow a project evidence snapshot
without selecting a linked plan or exactly one PDF. The dialog and manifest
explain the missing prerequisites. All selected PDFs remain separate; zero or
multiple PDFs do not acquire a fabricated current-PDF designation.

A supplied plan must still include its exact revision token, exist in the
reviewed inventory, and match the current project, workspace, and revision.
A disappeared or changed plan is refused rather than silently omitted.
Source-read failures, stale project/candidate reviews, human confirmation,
sensitive-file selection, byte custody, viewer refusal, and tenant boundaries
are unchanged. The archive remains a snapshot, not approval or publication.

Governed submission still requires the linked plan and one current report PDF,
supported evidence, freshness, exact stored ZIP bytes, and authorized human
review. No scientific default, acceptance rule, frozen study, or holdout changed.

## Verification so far

The new regression suite failed on the original route/dialog, including both
no-plan archive cases. A harmless comment mutation then survived all 47 focused
tests. Sixteen semantic mutations failed for their stated reasons:

- Requiring a plan again: both ordinary-archive creation cases failed.
- Requiring a PDF again: the project-only archive case failed.
- Allowing an unpaired plan identity: both malformed request cases failed.
- Silently omitting a supplied missing plan: creation incorrectly succeeded.
- Ignoring the selected plan revision: stale creation incorrectly succeeded.
- Changing the plan's workspace or project filter: exact query assertions failed.
- Restoring either UI prerequisite: the confirmed archive control stayed disabled.
- Inventing an archived plan: all three actual ZIP manifest cases failed.
- Choosing one of multiple PDFs: the null current-PDF assertion failed.
- Omitting either manifest limitation or either visible explanation: the
  corresponding disclosure assertion failed.
- Bypassing submission readiness: both real-readiness route cases incorrectly
  returned 201 instead of 409.

Every mutation was restored by editing. Seven focused suites pass 52 tests;
TypeScript passes. The real ZIP tests inspect stored manifest fields and exact
PDF-entry checksums. Their GeoPackage fixture is not a real GIS validation.
Mocked route tests establish query and write behavior, not live RLS or UI layout.

A read-only live database check found an existing complete manifest accepted
by `project_decision_package_manifest_is_ready`. Copies with a null linked plan
or null current PDF were both refused. No database function or stored manifest
was changed. Full live isolation, rebuilt browser archive creation/download,
independent ZIP/GeoPackage/readiness checks, QA, current remote checks, and a
fresh complete twelve-job outcome run remain required before release.

Local evidence root:
`/home/nathaniel/.local/state/openplan/release-checks/v044-2026-09-05/`.
Logs use the prefix `archive-boundary-`. The distributed-loading candidate
remains retired and inconclusive. No v0.44 tag has been created.

## Freshness follow-up before browser verification

Review found one related false status: the approval panel treated an explicitly
unselected plan as a changed plan and would call a new ordinary archive stale.
The freshness comparison now skips only an explicit null plan selection.
A missing binding or changed selected revision still fails. Governed readiness
continues to reject the no-plan archive as not approvable.

The regression failed before this adjustment. Restoring the old requirement
or conflating a missing binding with an explicit null each failed the test;
both mutations were restored. The earlier 7b5a7ffb full QA was deliberately
interrupted, exit 130, before completing. Its partial output is not a QA pass.
