# Proven job records

A proven job record shows that one named planning job ran to completion on one
hosted commit in named places. It is one JSON file in this folder, with the
exported PDFs it names beside it. The registry lists a record under
`provenJobs` in `docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`. The
direction check (`npm run product:direction:check`) then reads the record and
refuses it unless every rule below holds.

Two records exist. `first-proven-job.v1.json`, recorded November 14, 2026, is
the safety action plan and SS4A application in three places;
[first-proven-job/README.md](first-proven-job/README.md) says what it shows,
what it does not, and every attempt. `second-proven-job.v1.json`, recorded
November 15, 2026, is a public engagement campaign with its review report and
a published response in three places;
[second-proven-job/README.md](second-proven-job/README.md) says the same for
it. Both were run by an agent on the hosted site, and no person reviewed
whether the artifacts are useful.

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
the start and end of each journey, place kinds and Census ids, agent
executors, a record date that fits its journeys, artifact custody, no DRAFT stamp, accessibility rows at the stated
widths and modes, the cross-workspace rule, required limits and the string
scans. What a job needs because of what it is lives in its definition entry:
value rules on journey fields (`journeyFields`, and `fields` on one journey),
an independent source check (`sourceCheck`), required screens, workbooks, the
campaign agreement rules (`campaign`) and the public participant's refusals
(`participantChecks`). Two shared rules take their words from the top of
the definitions file: what an agent executor is (`executors`: a listed
harness running a model named by a model id) and how a record's date must
fit its journeys (`recordedOn`). A job's entry may also pin the
accessibility engine and tags (`screens.axe`), refuse console errors on its
required screens (`screens.consoleErrorsRefused`) and hold the words of each
limit it names (`limitTexts`), which the journey's assembler writes and the
checker requires.

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

Later that day (lane 49) the checker began to render the map page itself
instead of taking the map on trust, which closes nine of the ten single
changes the review found. The tenth, a place's Census id changed with its
label kept, stays open: no committed table maps a Census id to its name.

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
4. Each journey names its executor and how the sign-up confirmation was
   read: `email_link`, `operator_relay` or `admin_generate_link`. The
   executor is an agent: a harness the definitions file lists (`Claude
   Code`, `Codex`) and a model named by a model id such as
   `claude-fable-5-2`, never a person's name or `none`. The record is dated
   no earlier than the day its last journey ended and no more than 14 days
   after it, read in the zones that give each bound the most room (UTC-12
   and UTC+14), so a record dated in any zone on the day its last journey
   ended is accepted.
5. Every journey stored at least one crash, ranked at least one high-injury
   segment, saved at least one countermeasure and recorded at least one
   approved comment and one staff review. The Nevada journey's crashes come
   from `fars-national`.
6. Each journey saved a benefit-cost analysis and has both PDFs, a safety
   action plan and an SS4A application. Each PDF is a committed file whose
   SHA-256 and size match the record, has the page count the record states,
   carries no DRAFT stamp, and shows the five required items: the high-injury
   network map (found by a rendered page image), the crash summary,
   countermeasures, the benefit-cost analysis and the engagement summary
   (each found by `pdftotext` text on the page the record names). The
   checker renders the map item's page with Poppler's `pdftoppm` at 72 dpi
   and counts highlight-red pixels with the journey's own rule
   (`openplan/scripts/lib/poppler-pixels.mjs`); the page needs at least 40.
   When the item carries `pixelSha256`, the SHA-256 of the page's PPM bytes,
   the checker recomputes it and refuses a different one.
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
the checker applies rules 2, 3, 7, 8 and 10 above, and the executor and date
parts of rule 4, and refuses a record unless:

1. It has three journeys in any state: a county, a city or town (`city` or
   `cousub`) and a tribal area (`aiannh`), and each names a staff executor and
   a public participant executor. For a county, city or town, the one state
   code is the geoid's first two digits. Each journey ran in proof mode,
   confirmed its account by the emailed link and made its portal address from
   the share token, and the three journeys name three different campaigns and
   projects.
2. No AI feature ran, the staff review was approved, and the response is
   published and was not drafted with AI.
3. Contributions include a map point, a comment without a map point and one
   made at 390 px with the keyboard only; moderation approved at least one and
   rejected at least one with a reason.
4. Every comment a staff review theme lists was approved; the response answers
   only comments the themes hold and links to a decision on the campaign's
   project.
5. The internal and public review PDFs and XLSX files are committed files
   that match the record. The internal PDF reads "Internal review copy" and
   the phrases "Approved N", "Withheld N" and "Answered N" with the journey's
   counts, each found on its page with the shared matcher, and states each
   count sentence ("Received 4 contributions.", "Published 1 staff
   response." and the rest) with the journey's number and no other. The
   internal XLSX, read by cell, has the status the journey recorded for each
   moderated comment, the same approved and rejected totals, and published
   responses answering the same comments. Its Summary rows (Received,
   Approved, Withheld, Published staff responses, Answered by a published
   staff response) agree with its own cells, with the PDF's sentences and
   with the journey. The record also agrees with its cells (review 59): each
   rejected text is that comment's own body cell, each moderation the record
   says had a reason has a moderation note, each map point has a coordinate
   cell and each comment without one has none, the response is a Staff
   responses row, the decision link is a Decision history row naming the
   response, decision and project, the link's exact payload names the
   campaign, and a Synthesis actions row of the link names the staff review.
6. The public review PDF reads "Public review copy", says it leaves out
   withheld, pending and flagged contributions, states the approved,
   published and answered counts with the journey's numbers, and states no
   received or withheld count. The public XLSX has scope public, the same
   Summary counts and no Received or Withheld row, and its Contributions
   sheet holds exactly the approved comments. No sheet's header row, and no
   field it splits into the Long text sheet, is a staff-only field name, and
   no cell or Long text value holds one of the internal workbook's
   moderation notes under any name (a note of 20 characters or more is
   found inside a longer value; a shorter one only as the whole value). A
   rejected text is compared with its body cell with a Windows line ending
   read as a line ending on both sides.
7. The record holds each rejected comment's text beside its hash (a test
   entry that represents no one). The checker searches every review file
   for each rejected text and its comment id itself: the PDFs page by page
   and across each page break with the shared matcher, the workbooks cell by
   cell. A public file that
   holds one is refused, and so is an internal file that does not, since a
   search that cannot find the text where it is would pass a leak too.
8. The public response page was read at 1440 and 390 pixels in light and dark
   mode, shows the same approved and answered counts, was searched for every
   rejected text and shows none.
9. All six screens the journey checks (the portal, the public response page
   and the staff campaign's four tabs) were checked at both widths and modes,
   with zero serious and critical axe violations from the engine version and
   rule tags the definition names (axe 4.11.1; `wcag2a`, `wcag2aa`,
   `wcag21a`, `wcag21aa`), none scrolls sideways at 390 px, and none logged
   a console error. A third-party script's console noise therefore fails a
   run, and that is intended: a planner's page should not log errors.
10. A second account was refused the review PDF and XLSX downloads, the
    campaign read, the campaign export and the rejected comment's history as
    data checks, and the staff campaign page as a page check. Each check
    names the journey it was made for, and each journey has each of the six
    once.
11. An anonymous participant was refused the campaign read, the campaign
    export, the rejected comment's history and both downloads (401, 403 or
    404), and the public portal read carried no staff-only field. Each
    refusal names its journey, and each journey has each request once; a
    refusal message names the journey too. The
    definition named a staff item list until November 14, 2026, but that
    route has no read, so it answered 405 (KI-2026-11-14-370).
12. The record states the job's limits (see the definition entry), each in
    the words the definition holds for it (`limitTexts`), so a limit cannot
    say the opposite of its id. A record may add limits of its own, and the
    second record adds four. No definition can name a limit a run has not
    yet found, so before a record is committed nothing holds it to its own
    added limits; that is inherent. Once committed, the record's bytes are
    pinned by SHA-256 in the capability registry, so dropping or rewording
    an added limit afterward fails the registry check (review 64, case 32).
13. Each journey's health readbacks report ok, and the end one reports the
    start's version and migrations. The start readback comes before the
    account was made, and the end readback after the campaign was closed.
    The close, from the run file: the save answered 200, the status reads
    closed, each public address read afterward shows the ended notice and
    none of the campaign's text, and the public portal data read afterward
    does not answer 200 with the campaign's text.

`qa-harness/engagement-job-journey.js --assemble` refuses a run file made on
another origin, a run that stopped or left its campaign open, a run that
names another expected commit, and, under the proof origin, a rehearsal run
or one that names no expected commit. The first job's `--assemble` applies
the same rule, less the close, to runs made from now on.

What the checker repeats for this job and what it takes on trust: it reads
all four review files again, so their counts, scope, approved-only rows, the
absence of every rejected text and id, and the record's agreement with the
internal workbook (rule 5) are its own findings. The rest is on the
journey's word, and the record must say so in four limits: what the journey
read on live screens (the public response page's counts and its search for
the rejected text, the portal data's staff fields, each participant and
second-account status, axe results, console errors, sideways scroll and the
closed campaign's public addresses); which build ran, since the health
readbacks are the journey's; which contribution was made with the keyboard
only and at which width; and the AI and approval flags. The record and its
files both come from the run: a run that wrote a false record and matching
false files is not caught, only a record that disagrees with its files. A
rejected text reworded, split across two cells, or split across a page break
with a header or footer printed between its parts is not found.

No hosted record of this job exists yet (KI-2026-11-14-313). The checker
refuses lane 53's local rehearsal record, and the November 15 dress
rehearsal re-assembled from its run files, for their local origin and
rehearsal mode only (KI-2026-11-15-020).

## What it cannot tell

The checker proves that the required parts are present and bound to one
commit. It cannot tell whether a PDF is useful to a planner, whether the red
marks on a map page are the right place's ranked segments, or whether a
place label names the place its Census id identifies (no committed table
maps a Census id to its name). It counts enough highlight red on the map
page; a page of another place's marks would pass. It does not recompute the
PNG hash (`imageSha256`): PNG bytes differ between Poppler builds whose
pixels are the same (Poppler 25.07 on Windows and 24.02 on Ubuntu 24.04 give
the first record's six map pages identical PPM bytes and different PNG
bytes). The first record predates `pixelSha256`, so its map pages are counted
but not matched to a hash. A Poppler release that rasterizes differently
would change the pixel hash. It cannot repeat a source check's comparison.
For the first job it counts cross-workspace checks per journey, so one
journey's checks repeated for each journey would pass. For the first job it
does not check console errors, page-level horizontal scroll, the
accessibility engine version or a limit's words; the record states them.
For the second job it refuses console errors and sideways scroll at 390 px
on required screens, but those are still the journey's readings. Reading PDF text
and rendering the map page need Poppler's `pdftotext` and `pdftoppm`;
without them the checker refuses the record.
