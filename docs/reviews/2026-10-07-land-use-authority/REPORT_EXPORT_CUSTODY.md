# Retained sources on direct report downloads

Source commit `f207ad158bafb3654b70c4af87634341dbcdb1ff`, October 7, 2026.
This is a bounded M1 report correction, not completion of M1 or v1.

## Problem and change

The report page checks its frozen plan content and saved implementation history.
The direct source-JSON route previously returned an artifact without those checks.
A damaged or incomplete retained record could therefore fail on the page and
still be downloaded through its direct URL.

The authenticated download now uses the same adopted-version and implementation
readers as the page. The adoption decision reader moves into a shared library,
so the page and download compare the complete retained manifest with the native
decision. An invalid record returns 503 with an error and no attachment header.
Absent legacy adoption details stay absent. The operational report row and the
artifact keep their existing download format; this does not certify all editable
report metadata or establish legal validity.

The plan link, report type and artifact identity each trigger verification.
Changing a report type alone cannot route a land-use artifact through the general
report download. Authentication errors also refuse the request when the auth
response happens to contain a user. Other report types keep their prior behavior.

## Engineering evidence

- 175 tests pass across five report suites. Four plain-copy tests pass separately,
  for 179 focused tests in six suites. The new route suite has 42 cases.
- TypeScript, changed-file ESLint and `git diff --check` pass.
- The primary control run has a passing baseline, one harmless survivor and 46
  targeted failures. A supplemental run has a passing baseline, one harmless
  survivor and three targeted failures for independent plan/type signals.
  All 49 faults fail their intended assertions and original source bytes are restored.
- Controls remove native checks, permit changed manifests, substitute invalid
  dates/hashes, drop query scope/projections, bypass authentication errors, and
  alter response status, headers or artifact selection. Key-order variation stays
  valid. Component controls preserve the missing-data disclosures after extraction.
- The clean identified webpack build succeeds in 65.3 seconds under an 8 GiB
  service limit. Observed build peak is 6,851,354,624 bytes. The source and final
  build commit match. No other heavy local check runs alongside the build.

An initial test command used a repository-relative path from the app directory,
so it did not create or exercise the new suite. The corrected runs above include
it. The first supplemental control script had a parse error before tests ran;
its failure log and corrected run remain in the evidence. Neither failed setup
counts as a passing or killed control.

The projected mocks assert report, membership, artifact, native version and
register query scope. They do not prove native cross-workspace RLS or concurrent
permission changes. GitHub's full QA, shuffled suite, live isolation and full
archive restore remain separate checks on the pushed head.

## T3 preview and downloaded records

T3 preview alone serves the identified build on port 3498 from the isolated
`land-use-plan-kinds-20261007` physical worktree. The process cwd and health commit
match the build. The first immediate health request preceded the listener and
failed; the next succeeds before browser work starts.

The journey starts at Land Use Plans, opens the existing synthetic plan card,
opens its adopted-plan report and downloads source JSON. It then returns through
Open plan workbench, opens the saved implementation report and downloads its
source JSON at 390 pixels. Both report views are inspected at 1440 and 390 pixels
with no horizontal overflow. The saved adoption decision retains its caveat and
details after the shared-reader extraction.

| Saved source | Downloaded bytes | SHA-256 |
| --- | ---: | --- |
| Adopted-plan report | 13,777 | `6e5bc2b73882a56b69285912e28c3e0d9b1b46b5f250285e524e7d24f60b02dc` |
| Implementation report | 2,008 | `9be5825f721ece6ab7b9a0055bed868fd7d24777384467c9548889909c9a85c6` |

Both files equal the corresponding native artifact metadata. The adopted file's
canonical plan hash and complete adoption manifest match the native version and
decision. The implementation file matches its append-only report register. It
retains `not_started`, while the current action remains `in_progress`. No report
creation, adoption or status write is repeated. Read-only before/after records
match; a deliberately changed status fails that comparison.

The file comparator accepts reordered JSON keys and refuses changed content
hashes, a substituted current status and a changed decision body. Additional
same-preview GET probes return 200 for each authenticated source, 401 without
credentials, and 404 for a missing report. Successful replies retain attachment
filenames and `no-store`; refusals return only errors and no attachment header.

No new console error appears during the successful navigation/download journey.
The two negative GET probes add the expected 401 and 404 network errors. Ten
older preview errors remain dated before this build's journey. Snapshot history
is bounded; recorded aborted route-prefetch requests are not presented as failed
report reads or silently removed. No fetch interceptor is installed.

The owned server stops normally after navigating T3 to the health page. Its
observed peak is 262,332,416 bytes, result is `success`, and port 3498 is clear.
The BCA, engagement and demonstration servers remain untouched.

## Resource interruption reported by the user

The existing `openplan-bca-full-final-ff3d2d2d.service` remains failed with
`Result=oom-kill`; its observed peak and limit are both 5,368,709,120 bytes.
The BCA worktree is clean at `ff3d2d2d` and matches its pushed branch. This check
finds no lost source edits. The failed job is not counted as passing and is not
restarted. Local verification stays sequential; unrelated processes are left alone.

## Remaining boundaries

Implementation-report creation still performs separate report, artifact and
register writes. It needs one scoped transaction, exact-request recovery, and
interruption, concurrency and current-permission checks. This reader correction
does not repair incomplete earlier creations.

Damaged-record and historical-state refusals use controlled tests; the native
browser case uses existing synthetic adopted records. It does not mutate retained
acceptance records to manufacture a broken fixture. Cross-workspace browser
acceptance, print/PDF, actual map drawing, nonempty related-plan/map cases, deeper
content trees and practitioner acceptance remain open. The full geography,
engagement, operational and scientific v1 requirements remain unchanged.

The [evidence folder](report-export/) retains scripts, controlled outcomes,
build/transport summaries and five screenshots. Its [hash manifest](report-export/sha256.json)
accounts for those files. Raw database records and downloaded source JSON stay
outside Git.
