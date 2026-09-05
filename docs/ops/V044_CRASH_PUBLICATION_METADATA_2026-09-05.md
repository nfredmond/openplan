# Crash file updates are not coverage cutoffs

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
