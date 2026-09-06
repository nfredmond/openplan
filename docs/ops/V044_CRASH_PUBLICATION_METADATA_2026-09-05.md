# Crash file updates are not coverage cutoffs

## Latest checkpoint at 12:11 UTC

On `708a5d43`, all 12,908 app tests, 135 live-isolation tests, the production
dependency audit and build passed. Remote CI `33963980561`, RLS `33963980554`,
and upgrade rehearsals `33963980587` and `33964001646` passed. These results
precede the failed-pull wording correction below. Remote browser smoke run
`33965099305` is still running on that earlier commit.

An actual new source acquisition, `0537dacf-a923-4c77-9460-9f184f4c19d1`,
completed with 4,781 reported and 4,123 mappable crashes. Its response has
2,050 bytes, SHA-256 `f7750d20bece2515cd5c297379255fef0854e42b0a3e4b4203b8d1ba2dcc532b`.
All four resource IDs and exact timestamps match the retained public manifest.
A no-op comparison survived; an altered timestamp failed. Desktop and 390px
screenshots after reloading showed the correct update disclosure with no
console errors or overflow. Their map queries had not settled, so they prove
publication metadata, not map totals. Evidence is in `safety-cutoff-migrated/`.

The complete run at `2026-09-05T11-48-41-463Z` did not pass. Its first-day job
finished partly after browser crashes and 39 console error lines, including
Chrome insufficient-resources failures. Neutral setup was interrupted. A new
browser reached the same account through sign-in, with its setup dashboard
intact and no console errors. Two stopped test copies were moved from `/tmp`
to `release-checks/v044-2026-09-05/retained-scratch/`, preserving their bytes
and reducing temporary-storage use from 13 GB to 9.1 GB. This is not proof of
the browser failure's cause. The original evidence remains unchanged.

The fresh complete run at `2026-09-05T12-01-16-054Z` finished first-day setup
with outcome yes, no findings, and no console errors. Neutral setup was
interrupted when the following false-output statement was confirmed during
supplemental report inspection. Neither run is a complete release pass.

### Failed pulls do not establish absent evidence

The Reports work queue on `708a5d43` said failed crash-data pulls meant the
affected areas had no observed crash records. The same workspace's Safety
history showed two completed and two failed acquisitions for the same county
and requested years. This is an unsupported absence claim, not deleted data.
Desktop and 390px report screenshots were inspected; Safety's completed
acquisition and retained records were also captured. Console errors were zero.
Evidence is in `failed-pull-claim-before/`.

Both shared queue producers now retain the failure counts and ask the planner
to inspect completed acquisitions. They make no inference about evidence
availability from failure status alone. No geography logic, database record,
write path, source claim, frozen report, model result, default or holdout changed.

The singular/plural regression failed twice on the original copy. Three focused
suites passed 45 tests after correction. A comment-only no-op survived nine
tests; restoring the false absence claim separately in each producer failed
both regression cases. Every mutation was restored. These tests verify the
summary text built from observed acquisition states; their stub cannot prove
database projection, actual geography overlap, or browser visibility. The
real same-area history supplies the counterexample, not a seeded fixture.

Fresh browser/report checks and a complete twelve-job gate are still required.
The scientific candidate remains retired and inconclusive. No release tag.

Current correction requires migration `20260905000003_crash_resource_update_provenance.sql`.
The initial no-migration design below was insufficient. The live acquisition
failure and corrective proof are recorded in the final section.

## Confirmed blocker and interrupted run

On `ac333fa2`, first-week run `2026-09-05T09-57-34-607Z` completed its first
four jobs with final outcomes of yes. During job 04, the Safety screen claimed
that the source's published data ran through September 5, 2026. The adapter
had derived that date from yearly files' `last_modified` metadata. Earlier
tests explicitly protected this incorrect interpretation. Those green results
did not establish the truth of the source claim.

The run was stopped. Safety was interrupted and the remaining seven jobs did
not run. Its raw reports and downloads remain intact. This is not a full
first-week pass. The next release gate must run all twelve jobs on one new,
identified checkout.

The [CCRS dataset](https://lab.data.ca.gov/dataset/ccrs) describes annual crash
files. [CKAN's DataStore documentation](https://docs.ckan.org/en/latest/maintaining/datastore.html)
describes resource update timestamps. A file modification does not establish
the last crash date covered by the published dataset. No authoritative exact
coverage cutoff was established from these records.

The downloaded manifest is 36,362 bytes, SHA-256
`9a4c170a0f18a80c7c23e5160f7373068218d0d52e3707ed2cbc648606ca09f2`.
Local evidence is under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`, including
`ccrs-manifest-20260905.json` and `safety-cutoff-before/`. Before screenshots
were inspected at 1440px and 390px. Neither had console errors or horizontal
overflow. The desktop map was still loading, so that screenshot proves the
false date claim, not map readiness.

## Correction

The adapter now returns each selected resource's identity, year, and exact
update timestamp, retaining null for unavailable update metadata. It does not
derive a coverage cutoff. Existing acquisition provenance JSON carries this
metadata without a migration or a new write path.

A shared reader recognizes explicit resource-update evidence and the legacy
last-modified label. Live reads, saved acquisitions, history, analysis
snapshots, shared Safety evidence, and report HTML distinguish file updates
from crash coverage. Legacy dates remain available as recorded file updates;
the stored row and frozen artifacts are not rewritten. Genuine annual FARS
coverage evidence retains its existing behavior. This interpretation is based
on metadata semantics, not a hardcoded jurisdiction.

## Regression proof

A comment-only no-op survived with all 122 focused tests passing. The following
18 mutations failed for their stated reasons; each source edit was restored:

| Mutation | Observed failure |
|---|---|
| Treat resource updates as coverage | Four evidence tests and three UI tests rejected false dates or missing metadata |
| Lose the retained legacy date on reread | Idempotence test lost the recorded date |
| Invent a CCRS coverage date | Three adapter tests rejected the fabricated cutoff |
| Drop CCRS resource rows | Three adapter tests rejected missing identities and timestamps |
| Discard persisted metadata | Existing ingest update lacked the provenance JSON |
| Discard live-read metadata | Real live-read producer no longer supplied the visible update note |
| Discard saved response metadata | Saved acquisition result lacked provenance |
| Omit report update note | Generated HTML lacked the recorded file update |
| Omit report update rendering | Generated HTML lacked the recorded file update |
| Bypass saved UI interpretation | Saved acquisition displayed the false cutoff |
| Bypass history interpretation | History displayed the false cutoff |
| Bypass live UI interpretation | Live read lost the explicit update disclosure |
| Drop analysis producer metadata | Analysis snapshot lost the source resource record |
| Bypass analysis interpretation | Snapshot revived the false date and lost provenance |
| Discard fetch-to-analysis updates | Actual analysis fetch lost the resource metadata |
| Discard single-source annual cutoff | Actual FARS analysis lost its supported annual date |
| Promote a backstop cutoff to combined coverage | Multi-source snapshot falsely claimed one common cutoff |
| Strip separate source publication custody | Multi-source snapshot lost each contributor's metadata |

Raw mutation results are retained locally in `safety-publication-mutations.json`.
The additional analysis-boundary results are in
`safety-publication-analysis-boundary-mutations.json`. Inspection caught that
the initial correction tested below the actual fetch merge, which discarded
publication metadata. The corrected fetch keeps single-source evidence and
separate contributor metadata, without deriving a merged coverage cutoff.
The tests cannot establish an upstream source's actual temporal completeness,
browser visibility, or database isolation. Those require source evidence,
identified-checkout browser checks, and live isolation checks respectively.

The seven-suite focused run now passes all 140 tests, and TypeScript passes. The
readiness registry is versioned to `2026-09-05.1` with the corrected adapter's
hash. Its jurisdiction claims and their review dates are unchanged. Existing
exported readiness records retain their original bytes and hashes.

Full QA, after screenshots, a fresh downloaded report, and the complete
twelve-job release gate remain pending at this checkpoint. No release tag is
authorized by the focused proof alone. The distributed-loading candidate
remains retired and inconclusive; frozen studies, holdouts, and defaults have
not changed.

## Other findings from the interrupted run

The engagement summary displayed a 2/2 sentence-citation count without visible
source links or identifiers. The original comment remained in Responses. This
is queued as KI-2026-09-05-055, not a claim that stored citations or grounding
were lost. Desktop and 390px supplemental screenshots were inspected, with
zero console errors and no overflow.

KI-2026-09-05-034 now has current `ac333fa2` browser proof. The neutral plan
workbench and an existing public plan both say source review is not established
when legal sources are absent. Both widths were inspected; no console errors
or overflow appeared. The public-text check's no-op survived, while missing
warning and false-date inputs failed. This proves disclosure, not legal
completeness, and does not substitute for the interrupted full release gate.

## Full-QA findings at 11:20 UTC

The first full QA attempt failed, with 12,906 tests passing and one stale
release assertion expecting readiness version 0.42.0. That expectation now
names 0.44.0. A whitespace-only registry mutation survived all three direction
tests. Reverting the registry release while recomputing its integrity hash
failed the intended release assertion, not an unrelated hash check.

The same run reported an unhandled copy-confirmation timer after the project
evidence panel was unmounted. The timer now belongs to a React effect with
cleanup. A new test failed before the repair because the exact timer was not
cancelled. A comment-only mutation survived all four bundle tests; removing
cleanup failed the same timer assertion. This changes neither bundle bytes
nor publication behavior. The full QA attempt's log is
`/tmp/openplan-v044-crash-publication-qa.log`. A complete new QA run is required.

## Live acquisition caught an omitted database constraint

Full local QA on `eb2f385b` passed 12,908 app tests, 135 live isolation tests,
production audit, and build. The fresh source acquisition nevertheless failed.
This was our implementation regression, not an upstream outage. The existing
`safety_crash_ingests_cutoff_provenance_pair` constraint required a date whenever
provenance was present. The mocked producer test missed that database rule,
and the existing live fixture did not include publication metadata.

The fresh twelve-job run `2026-09-05T11-28-04-139Z` was stopped. Its first job
completed; neutral setup was interrupted. No complete outcome pass is claimed.
The two failed acquisitions in the separate, earlier test workspace remain
intact. The second response and failure screenshot are in
`safety-cutoff-fresh-retry/`. The first supplemental helper also watched the
wrong response URL; its failed proof was retained and the helper corrected.

Migration `20260905000003_crash_resource_update_provenance.sql` permits explicit
resource-update metadata with no coverage date. It refuses resource updates
paired with a date, incomplete resource-update records, and unsupported
unpaired provenance. Existing null pairs and genuine coverage/provenance pairs
remain valid. It changes the constraint transactionally without deleting or
updating stored acquisitions. Operators must apply it before the corrected app.
The release inventory now records 246 migrations.

The existing live repeat-acquisition test now sends explicitly synthetic
resource metadata through the real producer and Postgres. Before migration it
failed with the exact observed constraint error. After migration it retained
both acquisitions' dates and resource identities, protected the prior crash
and person memberships, and withheld metadata from another workspace. Four
invalid provenance/date combinations were refused with check violations.
A comment-only no-op survived; dropping metadata during persistence failed
the live readback assertion. No application records were changed by this test;
its own synthetic fixture is cleaned up.

`prove-publication-constraint.cjs` copies the actual database check definition
into transaction-local test tables. A no-op survived. Requiring a date,
allowing an update to masquerade as coverage, allowing missing resources, and
removing pairing enforcement each failed its stated probe. These are mutations
of the copied expression, not changes to the application's live constraint.
Every probe rolls back. Actual enforcement is covered by the producer/live
test above. The release inventory no-op survived five checks; a stale count
failed two, and a stale migration high-water mark failed three.

The earlier remote `eb2f385b` isolation run initially failed before testing
because the temporary stack could not bind port 54324. Its retry and the
upgrade rehearsal passed. A new full QA, exact-commit upgrade, fresh source
acquisition, report, and complete twelve-job run are still required after the
database correction. Frozen modeling evidence and defaults remain unchanged.
