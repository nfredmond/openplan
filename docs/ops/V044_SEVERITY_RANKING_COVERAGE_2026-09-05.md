# Severity-ranking coverage and browser controls

This supplements the two earlier September 5 continuation records. No v0.44
release has been tagged, and the complete first-week gate remains outstanding.

## Download check correction and result

The initial browser script wrongly required each attachment to emit a page
response event. Native downloads do not reliably emit that event. I reported a
navigation diagnosis before separating that check error from the product.

The corrected script waits for the actual browser download, checks its failure
state, hashes the saved bytes independently, and compares all 42 method files
with their displayed hashes. The two top-level files are compared with the
frozen published bytes. No API fetch substitutes for a visible link click.

A separate checkout and production build of `898a26e2` on port 3201 failed after
eight downloads with the corrected script, twice. The longer control waited 60
seconds for the ninth download. Its console recorded failed page-data fetching
for the attachment and a navigation fallback. This establishes the repeated
download failure; it does not establish which internal browser/router state
caused every failed request. The earlier response-event assumption was invalid.

On clean `8e7c45df`, native anchors downloaded all 44 files twice at desktop and
once from a 390px entry point. Hashes and byte counts matched across repeats.
Console errors were zero and document width matched viewport width. Main-agent
screenshot review confirmed the scientific caveats, separate methods, retired
candidate, and readable wrapped hashes.

Evidence is retained under
`~/.local/state/openplan/release-checks/v044-2026-09-05/`, including
`native-downloads/`, `mobile-downloads/`, `openplan-v044-safety-report-proof/`,
and `openplan-v044-original-link-control-repeat/`. The control checkout remains
at `/tmp/openplan-v044-download-control-V7aGiF`; its server was stopped.

## Coverage defect missed by the earlier filter correction

Desktop and 390px screenshots on `8e7c45df` confirmed the repaired severity
filters, requested-year history, and report Evidence disclosure. The console
was clean. But the same real FARS acquisition displayed combined KSI rankings
and tract comparisons with zero serious-injury counts. The earlier filter fix
had not covered those panels. Inspection found the same unguarded figures and
rankings in generated reports.

The existing `separatesSeriousInjuries` rule now governs those consumers.
Combined KSI rankings, demographic comparisons, and ranked report maps are
withheld unless the selected source coverage is established. Every selected
packet acquisition must qualify; one complete source cannot rescue an unknown
or partial source. Packet serious-injury and KSI figures are independently
guarded even if an old supplied summary contains a number. Supported fatal
counts and ordinary crash points remain available. No acquisition, raw data,
source, default, model output, acceptance rule, or holdout changed.

Twelve new cases initially failed against the existing implementation. The
restored focused run passed 124 tests in six files. A harmless comment survived
all 67 tests in the two changed test files. Seven isolated mutations failed for
their intended reasons: visible rankings, combined packet figure, packet injury
figure, mixed-source eligibility, concentration prose, equity prose, and the
ranked map. All mutations were restored. These tests cannot establish live
browser reachability or actual source completeness; the next identified build
must exercise the changed displays and generated report.

The full run `2026-09-05T03-14-12-381Z` was stopped during its first job before
editing. It is incomplete, not passing evidence. Its agent and the canonical
production server started by this continuation were stopped. Existing modeling
workers were untouched. CI 33940742999 and RLS 33940743016 passed on `8e7c45df`,
before this newest coverage correction; they must not be presented as its CI.
