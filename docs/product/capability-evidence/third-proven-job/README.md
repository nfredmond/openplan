# The third proven job: a California ATP application, in three places

Record: `../third-proven-job.v1.json`. Job:
`california-atp-application-in-three-places`, decided in
[the third proven job note](../../../reviews/product-direction/proven-jobs/2026-11-16-third-proven-job.md).
Recorded November 16, 2026. Every check named here was run by an agent. No
person reviewed the documents, and the record says so.

Read this beside the record. The record is what the checker reads; this
file says what happened, what was declared beforehand, and what the record
cannot show.

## What was proven

On the hosted site (`https://openplan-zeta.vercel.app`), on one commit
(`95be0369cd0ff55366d140d4b44522d18f499341`), an agent took a California
Active Transportation Program (ATP) application from sign-up to an exported
application PDF, three times, in three places:

| Journey | Place | Census kind and id | Ran (UTC, November 16, 2026) |
|---|---|---|---|
| County | Trinity County, CA | county 06105 | 15:15 to 15:40 |
| City | Yreka, CA | city 0686944 | 15:41 to 16:07 |
| Tribal area | Hoopa Valley Reservation, CA | American Indian area 1490R | 16:08 to 16:33 |

In each place the agent signed up and confirmed by the emailed link, made a
project, set its study place by the label the place search showed,
retrieved crashes, ran the corridor analysis the ATP packet reads its
screening scores from, tracked the ATP from the program catalog, and set up
the application. The application was seeded from catalog key `atp` and
identified as template `atp-2027`, the one that follows the Commission's
2027 Small Infrastructure application. The agent typed all ten sections
from the inputs and marked each final, gave each of the 26 checklist rows a
disposition, exported the PDF, and read it back. It used no AI drafting.

This was a rehearsal of the form. The 2027 statewide call closed June 22,
2026. Nothing was submitted to the Commission, and no agency or tribe made,
reviewed or submitted any of it. Each project name and every section opens
with or holds "Demonstration by an automated OpenPlan proof run". The text
describes no real project and makes no claim about a place.

What the three runs found:

| | Trinity County | Yreka | Hoopa Valley Reservation |
|---|---|---|---|
| Crash source | California Crash Reporting System | the same | the same |
| Crashes reported / stored, 2022 to 2025 | 995 / 979 | 80 / 80 | 134 / 134 |
| Census tract data | retrieved (4 tracts) | retrieved (2 tracts) | retrieved (1 tract) |
| Application PDF | 15 pages | 15 pages | 16 pages |
| DRAFT stamp | 17 required attachments outstanding | 17 | 17 |
| Screens checked | 16, none refused | 16, none refused | 16, none refused |
| Owner's own read and PDF download | 200, 200 | 200, 200 | 200, 200 |
| Second account (confirmed, signed in) | 404, 404, 404 | 404, 404, 404 | 404, 404, 404 |

The Census Bureau lists the Hoopa Valley Reservation in California only, so
OpenPlan read California's crash file inside it. Its PDF carries the
sentence that crash reports on tribal land may be missing from the state's
file, and the note that a Census tribal area is not a finding that a
project lies within federally recognized Tribal Lands. The other two PDFs
carry neither.

The DRAFT stamp is required by this job, not refused. An agent cannot
honestly produce a signature page or an engineer's checklist, and attaching
stand-ins would fabricate them. Eight rows that apply only in some cases
are marked not applicable with a reason that follows from what the
demonstration is (infrastructure only, no partnering agency, no phase shown
complete, no funds requested). Seventeen required rows stay outstanding,
and the product stamps each PDF with that count on its first page.

## What the record carries, and what the checker read again

The checker (`openplan/scripts/ops/capability-evidence.mjs`, run by the
product direction check with the Census Bureau's names on) accepts the
record. From the committed files it read again:

- each PDF's bytes against the record's SHA-256 and byte count, and that
  the three PDFs differ;
- each PDF's text with Poppler: the study place line for the record's
  place on the cover and in Appendix A; "Applicant not entered in
  OpenPlan"; the project and workspace names on the cover; the ten section
  titles in the template's order, each section opening with the
  demonstration label, Questions 5 and 7 carrying "The application asks no
  question here."; the six appendix headings; the DRAFT stamp with 17; the
  crash appendix naming California's crash file with the record's years
  and reported count; the tract-data sentence that matches the record's
  value; the tribal sentences in the tribal PDF only; and none of the
  phrases the definition refuses ("to be provided", a determination, a
  score with no OpenPlan label);
- each place's label against the Bureau's 2026 Gazetteer name for its id,
  and that the city is not a Census designated place.

From the record alone it checked: one hosted origin, one commit read back
at the start and end of each journey, proof mode, one clean harness
checkout, confirmation by emailed link, the template and catalog keys, no
AI drafting, every section's and checklist row's disposition, the crash
source and counts, sixteen screen rows per journey at 1440 and 390 px in
light and dark with the accessibility engine and tags the definition names
and no serious or critical finding, console error or sideways scroll, the
owner's control and the second account's refusals for each journey, three
different project and workspace names, and the thirteen limits in the
definition's words.

## Files

Listed with SHA-256 in the registry entry (`provenJobs` in
`docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`):

- the record;
- for each journey, its run file (`<role>/journey-<role>.json`: every
  step, reading and refusal as the journey wrote it, with no address, token
  or link) and its application PDF (`<role>/downloads/<role>-atp-application.pdf`);
- the three inputs files under `inputs/`: every string the journey typed;
- this file.

No screenshot is committed: signed-in screens show the test account's
address.

## Inputs

`inputs/trinity-county-ca.inputs.json`, `inputs/yreka-ca.inputs.json` and
`inputs/hoopa-valley-reservation-ca.inputs.json`, version 1. Each run file
names the hash of the inputs file it typed, and the three match the hashes
declared before the run. Each file lists its facts with a source and the
date read: the Commission's 2027 ATP Guidelines, Small Infrastructure
scoring rubric and Application Checklist, and one 2020 Census population
figure per place from the Census Bureau's map service. The Guidelines'
file hash is in each source line.

## The declaration and the attempt

The lead agent declared the run at 15:14 UTC, before the first hosted
sign-up, in the shared coordination file: the commit (read from the site's
health endpoint and from the document-export worker's deployment), the
three places, the input hashes, the pass criteria and the stops. Nothing in
it changed afterward.

There was one attempt and each journey ran once. The county ran alone
first; the other two started only after it ended with no finding. Before
each of the other two, the lead put the finished journey into the job's
synthetic example and ran the checker on it, to learn early whether the
real PDF would be refused. That pre-check is not the record's verdict and
changed nothing.

The site served the declared commit throughout: every health readback in
the record names it, and the worker's deployment was read on it before the
first sign-up and after the last journey.

## The checker's verdict, and whether it could have refused

Accepted, with the Census names on, by the checker at the declared commit.

It could have refused. The lead made 42 changed copies of the record, one
change each, in memory. All 42 were refused by the checker's own message:
a PDF hash or byte count changed; one PDF named for two journeys; a health
readback or the record's commit changed; a journey removed; rehearsal mode;
a harness checkout with changes; a local origin; a place id or label
changed; the tribal area listed in two states; another crash source; a
crash count or year range the PDF does not print; zero crashes; another
catalog or template key; AI drafting; a section dropped or reordered; the
outstanding count changed; a row claimed attached; a not-applicable row
with no reason; another tract-data value; no DRAFT stamp; a serious
finding, another engine version, a console error, sideways scroll or a
missing screen; the owner's control missing or refused; a second account
unconfirmed or reading the application; a journey's refusals removed; a
limit dropped or reversed; a shared project name; and a workspace name
holding the word DRAFT.

Before the run, two fresh-context reviews made 310 and then 62 more false
records against this checker and one reviewed the journey. They are
described in the job's known-issue rows.

## The hand check declared before the run, and its result

The lead read the text of all 46 pages and looked at every page image.

Met, in all three PDFs:

- no email address, no rehearsal fixture text, no "to be provided", and no
  stored underscore or colon code;
- every typed paragraph prints as typed, under its own section title;
- Appendix E's six rows state no determination; the tribal PDF's Tribal
  Lands row states that the study place is a Census tribal area and
  carries the note that this is not a finding;
- the tract data lines the PDF prints agree with the record's value
  (retrieved), which no local rehearsal had printed;
- the DRAFT stamp is on the first page, above the cover boxes.

Seen and recorded, not failures of the job:

- record ids print in the appendix index and source lines (pages 9 to 13),
  as provenance;
- the words "eligible" and "qualifies" appear twice in each PDF: in typed
  text that quotes the Guidelines' list of eligible applicants, and in the
  appendix note that says how a community qualifies under the Guidelines.
  Neither is a statement about this project;
- the product's own `[VERIFY: ...]` marker prints four times on catalog
  facts it has not read from a primary source;
- Appendices C, D and F print as "Missing": the job enters no cost
  estimate, links no engagement campaign and saves no benefit-cost
  analysis;
- the cover's last two boxes fall on page 2; the provenance table wraps
  each timestamp over several lines; the analysis run's title is cut short
  in two source lines; one PDF prints "1 tracts".

## Limits

The record states thirteen limits in the definition's words. In short:

- no PDF/UA check, and no keyboard-only or screen-reader pass;
- no planner reviewed whether the PDFs are useful;
- a rehearsal of a closed call; nothing was submitted;
- no attachment was produced;
- the only scores are OpenPlan screening scores, not Commission scores;
- no eligibility finding, disadvantaged community determination or
  finding that an application would pass the Commission's screening;
- every section is typed demonstration text that describes no real
  project; nothing checks that it says anything true about a place;
- only the Small infrastructure application was run;
- OpenPlan cannot yet hold an applicant's name, so every PDF says the
  applicant is not entered;
- the job does not require Census tract data; all three runs retrieved it;
- each journey leaves its two accounts, a workspace each, a project, crash
  records, an analysis run, a tracked opportunity, an application and an
  exported PDF on the hosted site, under the demonstration label. Nothing
  was published and no public page was opened;
- what only the journey read: the Census states listed for the tribal
  area, the stored crash counts, each section's and row's state on screen,
  the statuses the owner and the second account received, the screens'
  accessibility results, and which build, mode and harness checkout ran.

Three California places are not every place. All three are in one state,
because the job is a California program.

## What the checker does not catch

It reads words. It cannot tell whether a section says anything true,
whether a printed score is the run's stored score, or whether the rows a
planner saw on screen match the record. A record and PDFs falsified to
agree are not caught. Of the 310 false records review 78 made, 72 are still
accepted after the changes, and review 79 found none of them needs only a
careless journey; they are listed by kind in KI-2026-11-16-099.

## What a reader of the PDFs would still question

- The application names no applicant. A real application names one on its
  first page.
- Seventeen attachments are missing. That is the honest state of a
  rehearsal, and it is most of what the Commission's checklist asks for.
- The equity appendix prints an OpenPlan screening score of 0.0 for two
  places beside tract counts. The label says it is not a Commission score;
  a reader may still take a zero as a finding.
- The crash appendix for the reservation holds 134 crashes from the
  state's file. OpenPlan does not know how many crashes on tribal land
  that file lacks, and says so.

## What this does not change

The first and second proven job records, their files and their registry
entries are unchanged, and both are still accepted by the checker.
