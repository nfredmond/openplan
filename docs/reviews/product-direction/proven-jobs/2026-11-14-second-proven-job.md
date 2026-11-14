# Second proven job: an engagement campaign with a review report and a published response

Decided November 14, 2026 by the agent lead (Fable 5.2), from research 38's
ranking of candidate jobs. Written by lane 39 (Opus 5.5, agent), which added the
job's definition and checker rules. No person made or reviewed this decision;
under the November 13 standing direction in `AGENTS.md`, agents make
sequencing decisions and record the reason.

This note sits in a subfolder on purpose. The direction check
(`openplan/scripts/ops/product-direction-review.mjs`) reads the newest dated
Markdown file directly under `docs/reviews/product-direction/` as the latest
whole-product direction review, and a dated note there without that review's
metadata block stops the check. This note is not a direction review.

## The job

Id: `engagement-campaign-review-and-response-in-three-places`. Its rules are
data in `schemas/proven_job_definitions.v1.json`; its record shape is the
`engagementJourney` sub-schema in `schemas/proven_job_record.v1.schema.json`;
`openplan/scripts/ops/capability-evidence.mjs` applies both.

A staff account runs a public comment campaign for a project. A public
participant contributes through the portal. Staff moderate, write a staff
review whose themes list the comments they hold, and publish a response linked
to those comments and to a project decision. The planner hands over the
campaign review PDF and XLSX and the public response page.

A record is accepted only when:

1. It has three journeys, by place kind in any state: a county, a city or town
   (`city` or `cousub`), and a tribal area (`aiannh`). Places are rules; the
   record names the places a run used.
2. Each journey names two agent executors: a staff account and an anonymous
   public participant.
3. Each journey records the campaign and project ids, how the portal address
   was formed (never the token), and that no AI feature ran.
4. Contributions include at least one map point, one comment without a map
   point, and one made at 390 px with the keyboard only.
5. Moderation approved at least one comment and rejected at least one with a
   reason.
6. The staff review was approved, and every comment a theme lists exists and
   was approved. The published response answers comments the themes hold and
   links to a decision on the campaign's project. It was not drafted with AI.
7. The internal review PDF and XLSX are committed files whose SHA-256 and
   size match the record, with no DRAFT stamp and no secret on any page or in
   any cell.
8. The approved, rejected and answered counts agree: in the PDF, as the
   phrases "Approved N", "Withheld N" and "Answered N" found on their pages
   with the shared matcher (`openplan/scripts/lib/pdf-text-match.mjs`); in the
   XLSX, read cell by cell (each contribution's status cell; each published
   response's sources cell); and on the public response page, read by the
   journey at 1440 and 390 px in light and dark.
9. No rejected comment's text is on the public response page. The record
   carries a SHA-256 hash of each rejected text, never the text.
10. The portal and the staff campaign screens pass axe with zero serious and
    zero critical findings at both widths in both modes.
11. A second account is refused the review PDF and XLSX downloads and the
    campaign read as data checks, and the staff campaign page as a page check,
    under the cross-workspace rule the first job uses.
12. An anonymous participant is refused the campaign read, the staff item
    list and both review downloads (401, 403 or 404), and the public portal
    read carries none of the staff-only fields `moderation_notes`,
    `review_reason`, `metadata_json` and `respondent_fingerprint`.
13. The record states its limits (below).

## Why this job

Research 38 ranked it first among ten candidates for value per unit of
remaining work. The reasons that hold:

- Federal planning rules require documented participation and a response to
  it. 23 CFR 450.316(a): "The MPO shall develop and use a documented
  participation plan", including (a)(1)(vi) "Demonstrating explicit
  consideration and response to public input received during the development
  of the metropolitan transportation plan and the TIP". 23 CFR 450.210(a)
  requires a state to "develop and use a documented public involvement
  process", including (a)(1)(vii) "Demonstrate explicit consideration and
  response to public input". Lane 39 read both on the eCFR API, version
  2026-11-12, on November 14, 2026:
  https://www.ecfr.gov/api/versioner/v1/full/2026-11-12/title-23.xml?part=450&section=450.316
  and the same address with `section=450.210`.
- Grant programs score or require engagement. Research 38 read, on November
  14, 2026, and lane 39 did not re-read: the CTC 2027 Active Transportation
  Program Guidelines, which score public participation and planning and ask
  for evidence of the engagement conducted
  (https://catc.ca.gov/-/media/ctc-media/documents/programs/atp/cycle8/2027-atp-guidelines-a11y.pdf);
  and the USDOT SS4A FY2026 notice, which lists stakeholder engagement and
  collaboration among Action Plan components
  (https://apply07.grants.gov/grantsws/rest/opportunity/att/download/350790).
- It serves any place kind. Research 38 read the Census Bureau's 2022
  government counts (3,031 counties, 19,491 municipalities, 16,214 townships;
  https://cdn.www.census.gov/content/dam/Census/library/publications/2025/econ/govtorg2225.pdf)
  and the BIA list of 575 federally recognized tribal entities
  (https://www.govinfo.gov/content/pkg/FR-2026-01-30/html/2026-01899.htm);
  lane 39 did not re-read them.
- Most of the path is built and needs no AI key. The first job's journey
  already creates, moderates and reviews a campaign, and the hosted queue image
  runs the document-export worker that builds the review files
  (`workers/hosted-node/supervise.mjs`).

## What it does not show

The record must state each of these:

- `no-pdf-ua-check`: no PDF/UA check of the review PDF.
- `no-keyboard-or-screen-reader-pass-beyond-one-contribution`: one keyboard
  contribution at 390 px, and no other keyboard or screen-reader pass.
- `no-human-usefulness-review`: no planner judged the files or the response
  useful. Agent-run checks are the acceptance evidence (`AGENTS.md`).
- `test-comments-represent-no-one`: the comments were entered by the proof
  run. A few test comments are not public opinion.
- `response-speaks-for-no-agency`: the response was written for a labeled
  fixture place and speaks for no agency.
- `no-translation-or-ai-synthesis`: translation, AI moderation, AI synthesis
  and AI drafting are out of scope.
- `campaign-page-answers-200-with-not-found-screen`, when the staff campaign
  page answers 200 with the not-found screen (KI-2026-11-14-060 class).

It also does not show that the review report is representative of a
community, that counts agree past the first 200 contributions
(KL-2026-09-04-019), or that the hosted document-export worker has produced an
engagement review file; no hosted engagement review file has been recorded.

## Where the product cannot yet produce what the job asks

Found while writing the definition; the definition was not bent to fit. Each is
a known-issues row (KI-2026-11-14-310 to -313).

1. The review PDF prints the approved and withheld counts in a two-column
   table. Rendered locally from `buildCampaignReviewHtml`, Poppler reads the
   label and the number about 56 spaces apart, a column gap the shared matcher
   refuses, so "Approved 3" and "Withheld 1" are not found (KI-2026-11-14-310).
2. The review PDF prints no count of comments answered by a published
   response, so "Answered N" cannot be found (KI-2026-11-14-311).
3. No XLSX cell holds the approved, rejected or answered count. The checker
   counts the status and sources cells instead, which the definition allows
   as reading by cell. The public response page shows no rejected count and
   should not, so the rejected count is compared between the PDF and the XLSX
   only (KI-2026-11-14-312).
4. No journey script exists for this job, so no record can be produced yet
   (KI-2026-11-14-313).

Two places where the code shaped the design: the review files are internal or
public as a whole, so "the public part of any artifact" has nothing to bind to
in the internal files this job needs for the rejected count; and the lead's
cross-workspace rule needs a data refusal for every target, so the staff
campaign target requires its API read refused beside the page check.
