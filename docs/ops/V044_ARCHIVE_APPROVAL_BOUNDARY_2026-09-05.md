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

## Rebuilt verification on b96615c1

Full local QA passed 12,941 app tests, all 135 live isolation tests, the
production build, and the production dependency audit with zero advisories.
Seven focused suites pass 53 tests, including the freshness follow-up.

The identified build was reached through sign-in, Projects, the existing
corridor project, and its Evidence tab. No plan was created or selected. Two
reviewed archives were frozen through the ordinary UI: one with no optional
files, and one with only the previously inspected QA board PDF. Desktop and
390px screenshots show optional-plan disclosure, explicit confirmation, ready
archives, complete hashes, and a not-approvable explanation. Neither newly
created archive is falsely marked stale. No submission control is offered.
All eight screenshots were inspected; console errors and page overflow were zero.

Both ZIPs downloaded at both widths and matched independently read private
Storage bytes, retained database hashes, and their manifests:

| Archive | Bytes | ZIP SHA-256 |
|---|---:|---|
| Project-only, `858cb586-ae72-4e5e-ad35-9832f7c069b3` | 93,236 | `143eff7a930122b4f4f71186e3242bbab39f4e097e89a21a312fe63311e87440` |
| With PDF, `b056bfc8-f616-4c2e-aa46-2ae5b58c218f` | 417,160 | `843f57322504749e0803262c93b1b6c51e8e4c381d8300daf27b72d33f3d182a` |

Their manifest hashes are respectively
`ed75e2cbc81c1d23b8bf1cd4ada2b1d48adca83b3440c3c13c650c46b6e3125f`
and `193d703f48a9d45e88daa41c0b4eb2bdc86f45ccd3a3cc5e3d69d7cc2905961f`,
matching the visible full identities. Unchanged copies pass; changed and
truncated copies fail. An altered project JSON entry fails the independent
archive checksum check.

All seven project-only and eight with-PDF checksummed files verify. GDAL opens
all ten GeoPackage layers. The layer-status table distinguishes unavailable
model links, land-use designations, and project location from included project
area, corridor, 361 KSI crash points, and one publishable engagement geometry.
Unavailable layers have null reported counts, not invented observed zeros.

The included PDF has the unchanged Safety-map hash recorded in that correction's
proof. The five readiness statuses, applicability statements, limitations,
registry hash, and evidence hashes agree with the report and downloaded JSON.
ZIP and downloaded readiness JSON have identical content but different formatting
and therefore different file hashes. They are not claimed byte-identical.
The live database readiness function rejects both actual archive manifests;
neither has a submission row. This is a retained archive, not an approval.

Local raw evidence is in `ordinary-archive-after/`, including browser snapshots,
four ZIP downloads, byte proofs, and GIS status output. Remote RLS 33984918266
and Upgrade 33984939578 passed this commit. Main CI 33984918325 and browser
33984941059 were still running when this checkpoint was written. The fresh
complete twelve-job outcome gate remains required. No release tag.
