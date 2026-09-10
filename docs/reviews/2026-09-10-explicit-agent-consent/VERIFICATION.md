# Optional Planner Agent consent, in progress

Own checkout: `~/.local/state/openplan/explicit-agent-consent-2026-09-10`.
Base ad8aecfe from the pending v0.49.3 work. No release is declared here.
This extends roadmap A1a, without adding an action or changing approval tiers.

Safe/review actions previously ignored a supplied approval ID and returned no
approver. The verifier now applies the existing exact-payload, user/workspace,
action-kind, expiry and atomic single-use checks whenever an ID is supplied.
Without an optional ID the existing permissive route remains, with server-computed
hash and agent authorship. Invalid optional consent cannot silently fall back to
an unapproved call. Authorship comments now describe optional verified consent.

Forty-five tests across three files pass, and TypeScript passes. The first test
invocation ran from the repository root and failed imports without running tests;
it is not evidence. An existing no-approval fixture actually supplied a fake
approval ID through a helper. That fixture now omits the ID, matching its intent.
Separate new tests reject invalid supplied approvals for both safe and review tiers.

Mutation logs were inspected. A harmless comment survives. Ignoring optional
consent, requiring all approvals, bypassing the header hash, ignoring user scope,
accepting a lost atomic consume, spoofing human authorship and omitting the read
projection each fail their named assertions. Query projections and consume filters
are asserted. These unit fixtures cannot establish live RLS, browser delivery,
process-loss recovery or atomicity between the domain effect and the audit.

Remaining: full QA/shuffled/isolated RLS, actual UI/API approval retention and
replay rejection, browser desktop/390px and console inspection, final CI/upgrade.
Current business effect, approval consumption and audit persistence remain separate
operations; this change does not solve durable effect receipts or recovery.

## Report-route integration checkpoint

Reading the two permissive action routes found verification after the report or
artifact write. It now runs before any write. The RTP generation branch formerly
returned without auditing; it now records the same verified identity as project
and campaign generation. Returned or thrown audit persistence errors warn without
changing an already completed report/artifact response into a failure.

Seventy-four report-route tests pass. Invalid optional approval at report creation
and all three generation targets refuses before report/section/upload/artifact
writes. Audit transport throws preserve successful effects at every target.
A harmless comment survives; removing request approval headers, propagating audit
throws and omitting the RTP audit each fail the intended assertions. These tests
use database fixtures and do not prove live persistence or cross-workspace RLS.


## Single-effect consent boundary

The existing create-and-generate quick link performs two requests, but a single
approval cannot be consumed by both, and the report ID for the second does not
exist when the first is approved. Explicit approval preparation now refuses that
compound request with instructions to create the record and approve generation
separately. Existing non-approval quick links remain supported. Explicit false
and null defaults normalize to the same single-record action; a true generation
request stays distinct in the hash. This does not implement compound approvals
or durable delegated assignments.

Eighteen approval/hash tests pass. A harmless comment survives; failing to
normalize false/null defaults, erasing a second requested effect, permitting a
compound approval or refusing an existing non-approval quick link each fails its
intended assertion. Final full QA and browser evidence remain outstanding.

## Production and browser checkpoint

At5df4ffe8, full QA/build and shuffled seed914095 pass13,509 tests in1,234 files;
33 files/299 tests are explicitly skipped. Dependency audit reports no findings.
The identified production server at3279 uses the owned disposable target API22301.
Desktop1440px and390px real navigation, synthetic proposal streams, actual approval
UI and live report/generation routes retain separate approver/time/hash records.
Both creation and generation replays return403 and preserve one effect each.
No paid model was called; proposal text was a labeled deterministic test stream.
Console review found no browser errors. Screenshots were opened and inspected.

The initial desktop report-link selector required an exact URL, but the actual
Reports link includes a release-review anchor. Its consent/effect evidence remains
valid. The corrected navigation was used for mobile without recreating the desktop
report. Synthetic report IDs511fb9bb-67dc-4731-8732-79a7477b6258 and
9961f412-156e-4a4e-ace8-6a051eea9d54 remain available for final readback.

Mobile report inspection confirmed the RTP generation-history cards had no saved
artifact download link, although the authenticated download route already existed.
Each card now links its exact retained artifact, including older versions. Eighteen
focused component/download-route tests pass. A harmless comment survives; removing
the link or substituting the newest artifact for a historical one fails the intended
assertion. Final rebuilt browser download/PDF inspection remains outstanding.

## Download and print correction

At 7b577acf, desktop and 390px native keyboard downloads saved the original HTML,
a new PDF and the original HTML again. Both originals remained byte-identical.
PDF bytes matched retained Storage bytes; anonymous requests returned 401. Console
inspection found no errors. PDF inspection then found crowded financial headings,
orphan section headings and short chapter cards split over pages.

The RTP export stylesheet now spaces financial columns and asks print layout to
keep headings with following content and short cards together. Oversized cards can
still fragment. A browser style probe measures financial heading gaps of 16px.
A harmless comment survives; removing padding fails the spacing assertion, and
removing either print-break rule fails its computed-style assertion. These checks
cannot prove pagination or long-document readability. Actual regenerated PDF page
inspection remains necessary. Twenty-two existing export/component tests pass.

At eeec5606, both fresh native PDF downloads matched retained Storage and both
older HTML/PDF versions remained byte-identical after regeneration. All eight pages
of each new PDF were opened and inspected. Financial headings are separated,
chapter cards stay intact, and section headings keep following content. The cost
is eight pages instead of seven, with some whitespace before a kept-together card.
These are synthetic draft cases, not completed agency plans or prescribed forms.
Poppler rasterization emitted Type 3 glyph bounding-box warnings; inspected pages
and text extraction showed no missing text. This is not PDF/A validation.

The first production launch omitted OPENPLAN_COMMIT_SHA. Identity verification
refused it before browser work. The frozen build was restarted with eeec5606 and
positively identified. The mobile history screenshot then exposed 411px content
in a 292px grid, despite reachable download links. Both nested grids now use a
shrinkable single column below the existing desktop breakpoint. A final measured
browser pass and targeted restored-auto-grid mutation remain to run.
