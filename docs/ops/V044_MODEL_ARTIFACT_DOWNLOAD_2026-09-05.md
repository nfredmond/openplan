# Model artifact download correction

This supersedes the pending browser and QA work in the agreement-rounding
record. It does not supersede any frozen model result. v0.44 is not ready to tag.

## Completed checks on 6fe3ab9e

The rebuilt agreement map displayed the intact worker output at desktop and
390px. The original failing GeoJSON still has SHA-256
`953bc70b7a6a17e02912fd466111110f2fa77c977e95dcaf32e105275f3581e3`.
All four actual baseline/build JSON and GeoJSON artifacts passed the corrected
verifier. Browser console errors and horizontal overflow were zero. The phone
map's callout partly covers its zoom controls, a separate queued layout issue.

Local QA passed 12,894 app tests, 135 live isolation tests, the production-only
dependency audit, and the build. The unchanged Python agreement producer passed
63 tests. CI 33954109848 and RLS 33954109892 succeeded on this exact commit.
The full dependency audit still reports ten development-package advisories.
The v0.43 upgrade rehearsal 33949211278 passed on an earlier commit with the
same current migration bytes. These results do not verify the later download fix.

The diagnostic run `2026-09-05T08-11-38-598Z` exercised jobs 05 through 11.
Jobs 05, 07, 08, 09, and 10 completed with explicit yes outcomes and no console
errors. Job 06 reached the implementation-report controls but hit the runner's
30-minute limit before recording a completed outcome. Its timed-out attempt
remains preserved. Future attempts will allow 90 minutes without changing the
job's requirements or imposing a limit on model execution.

The portfolio round trip kept all four rows skipped and committed no import.
The XLSX preserves USD 4,200,000, 1,150,000, and 7,600,000 with blank price years
and source-document links. The Safety project's unknown fields remain blank.
Those cost cells are text, not numeric Excel cells, a queued interoperability
gap. The workbook was inspected in OpenPlan and its XML checked independently;
no standalone workbook renderer was available.

The project bundle's nine checksummed files and ten GeoPackage layers opened.
ZIP SHA-256 is
`0cd320a9c97f4cf40aecb85e4c86c53b2b2429503582cd0f7405caadb64bdd56`.
The planner left model artifacts unselected. Excluded and reference-only files
remain explicit, so this is not a claim that the ZIP contains every model file.
All nine PDF pages were viewed. Cost and source caveats remain intact, but
split cards and a mostly empty final page still need print-layout work.

The two-person handoff returned the first package and approved its replacement.
The replacement ZIP and receipt agree on SHA-256
`e74d281425233eb8245f24b01eda666b46879894a592564dcde2a7b73262d337`.
Receipt SHA-256 is
`c748349012bfbd359a45ae0010670d6b783456d0b433c002bb8f8149245ce113`.
Creator and approver identifiers differ; the receipt names the assigned
approver and keeps publication, adoption, and model validation false. Both
desktop and 390px approval screens were viewed, with full readable hashes,
no horizontal overflow, and no console errors. The browser reused its ZIP
filename; the original returned package was subsequently downloaded through
its visible control into a separate file and matched its earlier hash.

The independent ZIP check accepted a no-op copy and rejected an altered
project byte. Receipt checks accepted an unchanged copy and rejected an altered
bundle hash, self-approval, an unassigned approver, and each promotion flag.
These checks do not independently authenticate database actors or establish
the truth of every source claim inside a bundle.

## Download failure found during job 11

All 42 v0.44 downloads really match their published sizes and hashes, totaling
347,273,156 bytes. Both Butte County v0.43 audit/diagnosis pairs also match the
exact published bytes. These are independent file checks, not transcribed hashes.

The agent's final narrative claims a completed, clean journey. That claim is
too broad. Its download directory lacks the current assessment, comparison
basis, and input bundle, as well as most required v0.41 downloads. Its screenshot
shows the current assessment opened as raw JSON in a tab, not saved as a file.
A Storage favicon 404 appears in the console. The existing runner explicitly
allows that named favicon response, so its derived job verdict passes; the
agent's claim of zero recorded errors is still inaccurate. The overall run
fails because land-use timed out. Neither result establishes all twelve outcomes
or complete model artifact delivery. Raw reports and verdicts are unchanged.

The stored-artifact branch of the existing download route signed a viewing URL.
Unlike the local-file branch, it did not request attachment delivery. It now
passes `download: true` to the existing signer, as documented by
[Supabase](https://supabase.com/docs/reference/javascript/file-buckets-createsignedurl)
and confirmed in the installed SDK. The authorized object path, short lifetime,
tenant checks, file bytes, and local-file behavior remain unchanged. No database
write, model rerun, schema, acceptance rule, or default change is involved.

Four focused tests failed before the fix because the signer received no
download option. A harmless comment mutation then survived all 14 route tests.
Disabling attachment delivery failed four tests. Stripping the download query
from the redirect failed three. Both mutations were restored, and all 34 tests
across the route, volume-source, and artifact-migration suites passed. These
mocked tests check what the route requests; rebuilt native browser downloads
and their independent hashes remain required.

## Remaining boundary

The supplemental project-tab script twice clicked Evidence without activating
it; one attempt succeeded after waiting for the page to settle. The root cause
is not established. This is queued for a timed reproduction, not labeled a
permanently unreachable workflow or silently dismissed as script-only.

Run the repaired download journey and the long land-use journey on a new,
identified checkout. The old same-SHA land-use resume is no longer appropriate
after this code change. Finish full QA, current CI, exact downloads, release
migration bookkeeping, and the complete twelve-job outcome gate before tagging.
The Safety screening-versus-full-grant-case scope question remains open; its
prior partial result has not been rewritten and no treatment or benefit facts
have been invented.

Local raw evidence is under
`/home/nathaniel/.local/state/openplan/first-week-runs/2026-09-05T08-11-38-598Z/`.
Supplemental proofs and continuation notes are under
`/home/nathaniel/.local/state/openplan/release-checks/v044-2026-09-05/`.
The published distributed-loading candidate remains retired and inconclusive.
Frozen studies, untouched holdouts, separate methods, and production defaults
remain unchanged.
