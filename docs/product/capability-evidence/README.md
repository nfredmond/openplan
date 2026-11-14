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
- `schemas/examples/proven_job_record.v1.synthetic.json`: a complete synthetic
  record. The checker tests accept it against synthetic files. It is not
  evidence.
- `openplan/scripts/ops/capability-evidence.mjs`: `validateProvenJobRecord`.

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
5. The Nevada journey stored at least one crash from `fars-national`.
6. Each journey saved a benefit-cost analysis and has both PDFs, a safety
   action plan and an SS4A application. Each PDF is a committed file whose
   SHA-256 and size match the record, has the page count the record states,
   carries no DRAFT stamp, and shows the five required items: the high-injury
   network map (found by a rendered page image and its hash), the crash
   summary, countermeasures, the benefit-cost analysis and the engagement
   summary (each found by `pdftotext` text on the page the record names).
7. Every screen was checked at 1440 and 390 pixels, in light and dark mode,
   and every check reports zero serious and zero critical axe violations.
8. A second account's requests for the first account's safety action plan and
   SS4A application returned no content. Each check names its request and
   kind. A `data` check (an API route or a file download) counts only with
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
   that found different counts refuses the record.
10. No text field and no PDF page holds an email address, a plus-address, a
    JWT, a provider token (including any `sk-` key), a sign-in link, a cookie
    or a password. The refusal names the field or page, never the value.

The registry entry holds the job id, the places (kind, Census id, state FIPS,
in journey order), the commit, a review date and `evidence: [{path, sha256}]`.
The entry's evidence must include exactly one record, and its job, commit and
places must match that record.

## What it cannot tell

The checker proves that the required parts are present and bound to one
commit. It cannot tell whether a PDF is useful to a planner, whether the map
image shows the right network, or whether a place label names the place its
Census id identifies. It does not check console errors or page-level
horizontal scroll; the record states them for a reviewer. Reading PDF text
needs Poppler's `pdftotext`; without it the checker refuses the record.
