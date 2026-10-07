# Retained adoption records and related plans in reports

October 7, 2026. This continues the [report identity check](PUBLICATION_REPORT_CUSTODY.md).
Source commit `0235e5bc` adds the adoption record and related-plan references to
the signed-in adopted report. Build `ac06c23bec73f807347507cbd8692986056f777a`
includes the existing main merge commit, without further file changes.

## Behavior and custody

The report presents the decision body, decision type, instrument, decision date,
effective date and vote retained at publication. Missing optional values say
"Not recorded." It compares the complete retained manifest with the native
append-only decision, its database-computed manifest hash, plan, version, content
hash and review-release identity. The read uses the authenticated client and
filters by the retained manifest hash. It does not select a later decision.

PostgreSQL hashes its jsonb text representation. The reader compares that native
hash and the complete manifest; it does not substitute the plan's canonical JSON
hash algorithm. Malformed, mismatched, missing or unreadable decision records
withhold the decision details while preserving separately verified plan content.
Reports without a retained manifest disclose that absence. Neither a saved record
nor its absence establishes legal validity or an agency's actual action.

Related-plan labels, relationship kinds and notes come from the verified frozen
snapshot. Missing labels and kinds remain explicit. No links substitute a related
plan's current content for the reference retained in this edition.

## Checks

[Eighty-five tests in five suites](report-adoption/focused-final.log), TypeScript,
changed-file ESLint and the [production build](report-adoption/build-status.json)
pass. Initial static checks catch a nullable-version narrowing error and an
unescaped JSX apostrophe. Both are corrected before the final checks.

The [fault controls](report-adoption/controls/report.json) pass the baseline and
harmless-comment run, then fail 33 targeted broken behaviors for the stated
assertions. These include changed decisions and supporting evidence, wrong native
and retained identities/hashes, partial records, unreadable or missing decisions,
invalid dates, omitted query fields/filters, lost optional-value disclosures and
missing relationship content. A key-order-sensitive comparison also fails the
valid reordered-record case. The original source bytes restore after each case.
These are mounted components and projected mocks. They do not prove live RLS,
all malformed historical records, browser layout or professional acceptance.

## T3 journey and downloaded artifact

The owned production process serves the identified build from the isolated
checkout on port 3498. T3 follows the actual plan-list card to the workbench and
its adopted-report link. No publication or adoption command runs again. The
[desktop decision](report-adoption/reportAdoptionDesktop.png) and
[390px decision](report-adoption/reportAdoptionMobile.png) show the retained
synthetic record, including its explicit no-agency/no-vote labels. The mobile
document is 390 CSS pixels wide, with no measured horizontal overflow.

The [desktop](report-adoption/reportRelationshipsDesktop.png) and
[mobile](report-adoption/reportRelationshipsMobile.png) related-plan sections
state that this edition retained no references. Populated relationship rendering
passes component tests but still needs a real browser producer journey.

A fresh read-only SQL query on isolated DB29822 finds the same two versions, one
decision and one report artifact as the preceding publication checkpoint. T3
keyboard activation downloads 13,777 bytes of provenance. The
[comparison](report-adoption/report-adoption-download-verification.json) matches
the native artifact, frozen canonical hash and displayed decision fields. A
harmless key-order change passes. Changed area, decision, relationship and
displayed-body controls fail. Raw native records and browser journals stay outside
git. The raw provenance endpoint itself has not gained a new verification guard.

The [browser record](report-adoption/browser-summary.json) uses unmodified native
fetch and contains no new console error during this read-only journey. It retains
the seven earlier Electron, startup and request-observer errors by timestamp.
Console text is bounded, and older network/action entries are omitted. This does
not establish a complete network audit or normal post-write refresh.

The build runs alone under an 8 GiB cap and finishes successfully in 63 seconds.
The [owned server](report-adoption/server-status.json) peaks at 256,978,944 bytes,
stops successfully and leaves port 3498 clear. Protected BCA, engagement and demo
processes remain untouched. The old BCA test service still records its October 6
23:02:21 PDT OOM failure at its 5 GiB cap; it is not restarted.

## Integration and remaining evidence

At preceding head `c9236ffa`, four GitHub checks pass while QA, shuffle, live RLS
and archive restore remain running. Earlier RLS attempt 2 and archive restore
also remain running. Fresh checks must pass on the next pushed head; none of
these live jobs is restarted to conceal or replace its result.

Mapped designations, nonempty maps and related-plan browser cases, deeper content
trees, print/PDF, implementation-report custody, publication concurrency/recovery,
remaining M1 geography cases and practitioner/counsel acceptance remain open.
This checkpoint does not close M1 or declare a release or V1 acceptance.
[Artifact hashes](report-adoption/sha256.json) retain the evidence for this step.

## Follow-up on the plain-language CI failure

GitHub QA at `c75b352a` fails one plain-language guard, with 18,916 other tests
passing and 1,544 skipped. Five new uses of "record" exceed the existing 249-use
baseline. The [local reproduction](report-copy/before.log) finds the same count.
The report now says "Saved adoption decision," "adoption details" and "frozen
plan version." The existing baseline stays unchanged. The relationship label
also says "Relationship saved as."

[Forty-seven focused tests](report-copy/controls/baseline.log) pass. The
[controls](report-copy/controls/report.json) include a surviving harmless comment
and ten failures covering missing disclosures, omitted relationship kinds,
removed caveats and a reintroduced jargon term. Original source bytes restore.
These component and source checks do not prove layout, native authorization or
practitioner understanding. New-build browser evidence remains pending; the
screenshots above identify the earlier build and wording.

The older `797d3ea6` live-RLS retry and archive-restore run now pass. The failed
first RLS attempt remains a port-conflict result. Subsequent live jobs keep their
own outcomes; a new push does not establish that CI passed.
