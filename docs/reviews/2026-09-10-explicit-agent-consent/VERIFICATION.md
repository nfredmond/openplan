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
