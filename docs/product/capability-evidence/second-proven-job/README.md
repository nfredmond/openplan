# Second proven job: a public engagement campaign, its review report and a published response, in three places

Recorded November 15, 2026. Record:
[`../second-proven-job.v1.json`](../second-proven-job.v1.json). Job
definition: `engagement-campaign-review-and-response-in-three-places` in
`schemas/proven_job_definitions.v1.json`. Decision note:
[2026-11-14-second-proven-job.md](../../../reviews/product-direction/proven-jobs/2026-11-14-second-proven-job.md).

**Every step and every check in this record was run by an agent. No person
reviewed whether the campaign, the review files or the response are useful.**

## What was proven

On the hosted site (`https://openplan-zeta.vercel.app`), on one commit
(`3af5a8b35860138e2a01214702ff7016b4b6fd32`), an agent took a public
engagement campaign from staff sign-up to the review files, three times, in
three places:

| Journey | Place | Census kind and id | Ran (UTC, November 15, 2026) |
|---|---|---|---|
| County | Coos County, OR | county 41011 | 22:58 to 23:16 |
| City or town | Lander, WY | city 5644760 | 23:16 to 23:26 |
| Tribal area | Hopi Reservation, AZ | American Indian area 1505R | 23:26 to 23:43 |

In each place the agent, as staff, signed up and confirmed by the emailed
link, made a project, set its place by the label the place search showed,
recorded a proposed decision, and created and opened a campaign. As an
anonymous participant, in fresh browser sessions, it sent four comments
through the public portal: one with a map point, one with no map point, one
typed with the keyboard only at 390 px, and one off-topic comment for staff
to withhold. As staff it approved three and withheld one, each with a
reason; wrote, corrected and approved a staff review that groups two of the
approved comments; published a response that answers those two; linked the
response to the proposed decision; and asked for the internal and public
review files. The hosted document-export worker printed them. The journey
then closed the campaign through its own settings screen.

The campaigns were demonstrations and said so. Their title and public text
opened with "Demonstration by an automated OpenPlan proof run" and named no
county, town or tribe. Every comment said it was entered by an automated
proof run and represents no one. The response said it speaks for no agency
or tribe. Each campaign was public for between about eight and fifteen
minutes and was closed by the journey that opened it.

## What the record carries, and what the checker read again

Per journey, the same in all three places:

- **Counts.** Received 4, approved 3, withheld 1, published responses 1,
  answered 2. The journey read these from ten surfaces (both review PDFs,
  both workbooks' Summary rows and cells, and the public response page at
  1440 and 390 px in light and dark) and they agree. The checker reads the
  four files again itself and refuses a disagreement.
- **The withheld comment.** Its text and id were searched for on 60 public
  surfaces (the public PDF, every cell of the public workbook, the portal
  and response pages as text and as HTML, and every same-origin response
  those pages fetched) and found on none. The same search found the text in
  the internal PDF and the internal workbook, so the search can find it
  where it is. The checker repeats the search on the four files and ties the
  text to the withheld comment's own row in the internal workbook.
- **Screens.** Six screens (the portal, the public response page and four
  staff campaign tabs) at 1440 and 390 px in light and dark: 24 checks with
  axe-core 4.11.1, zero serious or critical findings, no sideways scroll,
  no console errors.
- **Who can read what.** An anonymous participant got 401 from five staff
  reads (the campaign, its export, the withheld comment's history, both
  internal downloads), and the public portal read carried none of the
  staff-only field names. A second account in another workspace got 404 from
  both downloads, the campaign read and the export, 403 from the withheld
  comment's history, and the not-found screen on the staff campaign page
  with none of four identifying strings.
- **The demonstration's own text.** The journey set the campaign's public
  description to the invitation before the campaign went live, then read the
  portal and its about page at both widths and every page of both review
  PDFs: each shows the invitation and none shows the text the campaign was
  created with.
- **The close.** Status closed, the portal and about page show only the
  ended notice, and the public data read answers 404.
- **Health.** `/api/health` reported `ok` on commit `3af5a8b35860`, version
  0.72.0, 455 migrations expected, at the start and end of each journey.

## Files

Listed with SHA-256 in the registry entry (`provenJobs` in
`docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`):

- the record;
- for each journey, its run file (`<role>/engagement-journey-<role>.json`:
  every step, reading and refusal as the journey wrote it, with no address,
  token or public link) and four review files under `<role>/files/`: the
  internal and public review PDF (11 and 6 pages) and the internal and
  public workbook;
- the three inputs files under `inputs/`: every string the journey typed;
- this file.

No screenshot is committed: staff screens show the test account's address.

## Inputs

`inputs/coos-county.inputs.json`, `inputs/lander.inputs.json` and
`inputs/hopi-reservation.inputs.json`. Each run file names the hash of the
inputs file it typed, and the three match the hashes declared before the
run.

## The declaration and the attempt

The lead declared the job, the commit, the three places, the inputs' hashes
and the pass criteria at 22:58 UTC on November 15, 2026, before the first
hosted sign-up, after reading that the hosted site and the worker service
that prints review files both ran the commit. The lead read both again
after the last journey: unchanged.

There was one attempt. All three journeys ran on the declared commit, one
after another, and each reached its end health readback with its campaign
closed. No journey was rerun and no criterion changed.

Before the hosted run the journeys were rehearsed twice on a local build
with the same strings (November 15), and four fresh-context reviews were
made of the pieces: the review PDF's wording, the journey and checker, the
demonstration-text change, and the checker's fixes. The second of those
tried 90 changed copies of an honest rehearsal record against the checker
and got 32 false records accepted; the fixes brought that to 7, each
inherent, allowed by the definition or out of reach, and the hosted run
waited for them.

## The checker's verdict, and whether it could have refused

`validateProvenJobRecord` on the hosted commit accepts this record with its
twelve review files. Eighteen changed copies of this record, one change
each, are all refused by the checker for their own reason: a changed file
hash; an end health readback on another commit; a journey removed; a
journey in rehearsal mode; a local base URL; a campaign left open; a closed
portal still showing the campaign's text; a participant read answering 200;
one journey's participant refusals removed; the withheld comment recorded as
approved; the withheld text replaced with other words; the public and
internal PDFs swapped; a map point recorded for a comment with no
coordinates; a screen with a serious axe finding; a required screen
dropped; a required limit dropped; the response marked AI-assisted; a
second-account request answering 200.

## The hand check declared before the run, and its result

Declared: in the public copy, no record id, raw stored time, JSON or stored
code before the "Record identifiers" appendix; the same in the internal
copy's body; every time names its zone; the invitation on page 1 and no
template text on any page; no email address and no DRAFT stamp; the study
area names the project's place; each campaign closed.

Result, on all six PDFs: **met.** The lead swept every page before the
appendix (pages 1 to 9 of the internal copies, 1 to 5 of the public ones)
for ids, hashes, stored times, JSON, stored codes, email addresses, DRAFT,
the template's sentences and the old "Agency response" label, and found
none; every clock time is followed by UTC; page 1 carries the invitation
and the note on what entry numbers mean; the response is labeled "Staff
response". The same sweep on a review PDF printed before the wording
changes finds 18 ids, 5 stored times, JSON, the template text and the old
label, so the sweep can fail. The lead looked at page 1, a contribution
page and the response page of a public copy and the appendix page of an
internal copy. The 12-character snapshot hash in each page footer is a
provenance mark and was declared as allowed.

Two things the check found that are not failures of it:

- Lander's study area line reads "Lander" with no state. The place search
  showed "Lander, WY"; the saved place drops the state (known issue
  KI-2026-11-15-015). The journey recorded this as its own finding.
- The lead read each closed public page from the journey's anonymous
  screenshot, not in a separate session: the run files hide the campaign's
  public address.

## Limits

The record states each of these as a limit:

- No PDF/UA check was run on the review PDFs.
- No keyboard or screen-reader pass was made beyond one keyboard-only
  contribution per place.
- No person reviewed whether the artifacts are useful.
- The comments are test entries that represent no one, and the response
  speaks for no agency or tribe.
- No translation and no AI synthesis was used. The journey pressed no AI
  control.
- The readings of live screens (the public response page's counts and its
  search, the portal read's staff fields, every refusal status, axe, console
  errors, scroll) are the journey's; the checker cannot load a page again.
- Which build ran comes from health readbacks the journey wrote. The
  record's origin and each journey's mode are also the journey's own
  statements. Nothing in the record comes from the deployment itself.
- Which contribution was typed with the keyboard only is the journey's
  statement; the record holds no keyboard trail.
- The AI and approval flags are set by the journey after the app accepted
  each step.
- The closed pages were read from the journey's screenshots.
- The invitation's sentence about the automated review first ran on the
  hosted site.
- Every time in the review files is UTC, not the place's local time.
- No email was sent to subscribers; only account confirmation email was
  used.

Also true, and not in the record: three places are not every place. The
places were chosen by the lead, not sampled. Each campaign held four
comments; nothing here shows how the review files read with four hundred.

## What the checker does not catch

From the two reviews of the checker (KI-2026-11-15-021 and -041): a place's
Census id changed with its label kept; the keyboard-only label moved to
another comment; console errors (recorded, but no rule reads them); another
axe version or rule set; a limit whose text says the opposite of its id; and
a commit replaced consistently everywhere in the record. The first, fourth
and fifth are not inherent and can be closed.

## What a reader of the review files would still question

Found by the dress rehearsals and true of the hosted files too; none is in
this record's criteria:

- The public PDF splits the staff response across two pages.
- "1 reviewed staff response entries" and "0 survey sessions" read
  awkwardly, and the "Survey answer register" heading has nothing under it
  when a campaign has no survey.
- Every comment is titled "Untitled contribution", because the portal asks
  for no title.
- The portal's standing sentence "The project team reviews comments before
  they are shown here or used in reports" sat under the demonstration's
  invitation. It is true of the product; for a demonstration the invitation
  says the only review is by the same automated run.
- Public comment dates on the portal print with no time zone
  (KI-2026-11-15-013), and at 390 px the portal's first screen shows no
  campaign title until the sheet is opened (KI-2026-11-15-014).

## What this does not change

This record adds one job to the list of proven jobs. It raises no readiness
status for any state, and it is not evidence that an agency has used
OpenPlan for a consultation.
