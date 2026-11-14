# Proven job records

A proven job record shows that one named planning job ran to completion on one
hosted commit in named places. It is one JSON file in this folder, with the
exported PDFs it names beside it. The registry lists a record under
`provenJobs` in `docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`. The
direction check (`npm run product:direction:check`) then reads the record and
refuses it unless every rule below holds.

One record exists: `first-proven-job.v1.json`, recorded November 14, 2026, for
the job `safety-action-plan-and-ss4a-in-three-places` on commit `ccf88a921`.
[first-proven-job/README.md](first-proven-job/README.md) says what it shows,
the two attempts that failed first, and its limits.

## Files

- `schemas/proven_job_record.v1.schema.json`: the record's fields. The checker
  refuses any field the schema does not name.
- `schemas/proven_job_definitions.v1.json`: what each job requires, as data.
  Places are rules (a place kind and a state), never a named place. The record
  names the places a run used.
- `schemas/examples/proven_job_record.v1.synthetic.json` and
  `proven_job_record.v1.engagement.synthetic.json`: complete synthetic
  records, one per job. The checker tests accept them against synthetic
  files. They are not evidence.
- `openplan/scripts/ops/capability-evidence.mjs`: `validateProvenJobRecord`.

## Which rules live where

The record schema holds the fields every job shares, and each job's own
fields in a sub-schema chosen by `jobId` (its `allOf`). The checker's code
holds the rules every job shares: the hosted origin, one commit read back at
the start and end of each journey, place kinds and Census ids, named
executors, artifact custody, no DRAFT stamp, accessibility rows at the stated
widths and modes, the cross-workspace rule, required limits and the string
scans. What a job needs because of what it is lives in its definition entry:
value rules on journey fields (`journeyFields`, and `fields` on one journey),
an independent source check (`sourceCheck`), required screens, workbooks, the
campaign agreement rules (`campaign`) and the public participant's refusals
(`participantChecks`).

On November 14, 2026 (lane 39) the first job's saved benefit-cost analysis,
its Nevada crash source and stored count, and its crash source check moved
from code into its definition entry. A test runs the first job's synthetic
example and every case in `capability-evidence.test.ts` through main's
checker before the move (frozen in
`openplan/src/test/fixtures/proven-job-checker-main-1fbfe95ed/`) and through
the current one, and requires the same verdict and refusal text
(`proven-job-checker-equivalence.test.ts`).

On November 14, 2026 (lane 45) the checker gained rules that refuse single
changes a fresh-context review made to a copy of the first record and the
checker had accepted (KI-2026-11-14-303). Each new rule is one the committed
record meets: `first-proven-job-record-accepted.test.ts` runs that record
and its six PDFs through the current checker, and
`proven-job-checker-gaps.test.ts` makes each change to a copy of it and
requires main's checker to accept the copy and the current one to refuse it.
The strengthened checker accepts the first record.

## What the checker refuses

For the job `safety-action-plan-and-ss4a-in-three-places`, decided in the
[November 1 direction review](../../reviews/product-direction/2026-11-01-first-proven-job-review.md),
the checker refuses a record unless:

1. It has three journeys: a county in California (state FIPS 06), a county in
   Nevada (32) and a tribal area (place kind `aiannh`), each with a Census id
   in that kind's form.
2. The base URL is the hosted origin named by `PROOF_ORIGIN`. A local or
   preview run is a rehearsal, not proof.
3. The commit has 40 hexadecimal characters, and each journey has one start
   and one end `/api/health` readback whose commit begins that commit (health
   reports the first 12 characters).
4. Each journey names its executor (agent and model) and how the sign-up
   confirmation was read: `email_link`, `operator_relay` or
   `admin_generate_link`.
5. Every journey stored at least one crash, ranked at least one high-injury
   segment, saved at least one countermeasure and recorded at least one
   approved comment and one staff review. The Nevada journey's crashes come
   from `fars-national`.
6. Each journey saved a benefit-cost analysis and has both PDFs, a safety
   action plan and an SS4A application. Each PDF is a committed file whose
   SHA-256 and size match the record, has the page count the record states,
   carries no DRAFT stamp, and shows the five required items: the high-injury
   network map (found by a rendered page image and its hash), the crash
   summary, countermeasures, the benefit-cost analysis and the engagement
   summary (each found by `pdftotext` text on the page the record names).
   Each text item names its own heading from the definition (`itemHeadings`,
   such as "Appendix B. Crash summary" in the SS4A application), and that
   heading is a line of its own on the page, not words in a sentence or a
   table. The map item's page carries the words the export prints with its
   map (`mapPageText`: "High-injury network map" in the plan, "Source
   severity coverage" in the SS4A application).
7. Every journey checked each of the nine screens the definition names
   (sign-up, portal, dashboard, project, safety, benefit-cost, campaign
   responses, report and grant application) at 1440 and 390 pixels, in light
   and dark mode, and every check reports zero serious and zero critical axe
   violations.
8. A second account's requests for the first account's safety action plan and
   SS4A application returned no content. Each check names its request and
   kind. The report page, the report download and the application download
   are each checked once per journey: the first record's checks name no
   journey, so the checker counts them. A `data` check (an API route or a file download) counts only with
   403 (workspace access denied) or 404 (not found). A `page` check counts
   with 403 or 404, or with 200 when the journey read the rendered page and
   recorded `notFoundRendered: true`, `recordTextFound: false` and the
   SHA-256 of at least three distinct identifying strings it searched (report
   title, project name, workspace name, campaign title), never the text. The
   report page streams, so it answers 200 while it shows the not-found screen
   (KI-2026-11-14-060). Each target needs its download refused as a data check
   (`report-pdf-download`, `application-pdf-download`); a page check alone
   never satisfies the rule. Any other status, including a 401, a 5xx or a
   redirect, is inconclusive and refuses the record: a failed handler does not
   show that the workspace check refused the request.
9. The record states its limits: no PDF/UA check, no keyboard or screen-reader
   pass, no human usefulness review, FARS is fatal-only, unless a source check
   matched, crash counts not independently confirmed, and, when a page check
   answered 200, `report-page-answers-200-with-not-found-screen`. A source check
   that found different counts refuses the record. A source check marked
   matched names an https address on a host the definition lists for the
   crash sources (`static.nhtsa.gov`, `crashviewer.nhtsa.dot.gov`,
   `data.ca.gov`) and says in at least 80 characters what was compared.
10. No text field and no PDF page holds an email address, a plus-address, a
    JWT, a provider token (including any `sk-` key), a sign-in link, a cookie
    or a password. The refusal names the field or page, never the value.

The registry entry holds the job id, the places (kind, Census id, state FIPS,
in journey order), the commit, a review date and `evidence: [{path, sha256}]`.
The entry's evidence must include exactly one record, and its job, commit and
places must match that record.

For the job `engagement-campaign-review-and-response-in-three-places`, decided
in the [second proven job note](../../reviews/product-direction/proven-jobs/2026-11-14-second-proven-job.md),
the checker applies rules 2, 3, 7, 8 and 10 above and refuses a record unless:

1. It has three journeys in any state: a county, a city or town (`city` or
   `cousub`) and a tribal area (`aiannh`), and each names a staff executor and
   a public participant executor.
2. No AI feature ran, the staff review was approved, and the response is
   published and was not drafted with AI.
3. Contributions include a map point, a comment without a map point and one
   made at 390 px with the keyboard only; moderation approved at least one and
   rejected at least one with a reason.
4. Every comment a staff review theme lists was approved; the response answers
   only comments the themes hold and links to a decision on the campaign's
   project.
5. The internal review PDF and XLSX are committed files that match the
   record. The PDF reads "Internal review copy" and the phrases "Approved N",
   "Withheld N" and "Answered N" with the journey's counts, each found on its
   page with the shared matcher. The XLSX, read by cell, has the status the
   journey recorded for each moderated comment, the same approved and
   rejected totals, and published responses answering the same comments.
6. The public response page was read at 1440 and 390 pixels in light and dark
   mode, shows the same approved and answered counts, was searched for every
   rejected text (by hash in the record) and shows none.
7. The portal and staff campaign screens have zero serious and critical axe
   violations at both widths and modes.
8. A second account was refused the review PDF and XLSX downloads and the
   campaign read as data checks, and the staff campaign page as a page check.
   Each check names the journey it was made for, and each journey has each
   of the four once.
9. An anonymous participant was refused the campaign read, the staff item list
   and both downloads (401, 403 or 404), and the public portal read carried no
   staff-only field.
10. The record states the job's limits (see the definition entry).

No record of this job can pass yet: the review PDF prints its counts in a
table the matcher reads as a column gap and prints no answered count
(KI-2026-11-14-310, -311), and no journey script exists (KI-2026-11-14-313).

## What it cannot tell

The checker proves that the required parts are present and bound to one
commit. It cannot tell whether a PDF is useful to a planner, whether the map
image shows the right network, or whether a place label names the place its
Census id identifies (no committed table maps a Census id to its name). It
does not render the map page again: Poppler's `pdftoppm` reproduces all six
recorded image hashes of the first record on the workstation that recorded
them, but its PNG bytes depend on the Poppler, FreeType and zlib versions, so
a recomputed hash would pass on one platform only. It reads the words
printed with the map instead, which shows the page holds the map's figure,
not that the drawing is there. It cannot repeat a source check's comparison.
For the first job it counts cross-workspace checks per journey, so one
journey's checks repeated for each journey would pass. It does not check console errors or page-level
horizontal scroll; the record states them for a reviewer. Reading PDF text
needs Poppler's `pdftotext`; without it the checker refuses the record.
