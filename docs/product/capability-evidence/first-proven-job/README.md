# First proven job: a safety action plan and an SS4A application in three places

Recorded November 14, 2026. Every step and every check here was run by an
agent. No person reviewed whether the documents are useful, and the record
says so.

## What was proven

On the hosted site (`https://openplan-zeta.vercel.app`), on one commit
(`ccf88a9219fa58b67842a8f1dd41dbe3b371f8e5`, 455 migrations applied), an
agent took the job from sign-up to two exported PDFs, three times:

| Place | Kind | Crash source | Reported | Stored | Ranked segments |
|---|---|---|---|---|---|
| Sierra County, California (06091) | county | CCRS | 288 | 286 | 20 |
| Lincoln County, Nevada (32017) | county | FARS | 12 | 12 | 11 named road segments |
| Pyramid Lake Paiute Reservation, Nevada (3010R) | tribal area | FARS | 3 | 3 | 3 |

Each journey (`qa-harness/first-job-journey.js`, proof mode, 26 steps):
signed up and confirmed by the emailed link; created a project and set its
place by the label the search shows; retrieved crashes; ranked the
high-injury network; saved countermeasures and a benefit-cost analysis; ran a
public comment campaign, moderated it and approved a staff review; generated
the safety action plan report; tracked an SS4A opportunity, seeded its six
sections, typed and finalized each from sourced text, attached a budget
document and the plan, and exported the application; checked 36 screens with
axe-core 4.11.1 at 1440 and 390 px in light and dark; and, from a second
account, asked for the first account's report page, report PDF, application
and application PDF.

The record is `../first-proven-job.v1.json`. The six PDFs are in this folder.
`npm run product:direction:check` reads the record and the PDFs again and
refuses them unless every rule in `../README.md` holds.

## Results the record carries

- Both PDFs in every journey hold all five required items (the high-injury
  map, the crash summary, the countermeasures, the benefit-cost summary and
  the engagement summary), and none carries a DRAFT stamp.
- Every screen check reports zero serious and zero critical axe findings and
  no page-level horizontal scroll.
- The second account got HTTP 404 for the report page and for all three data
  routes, in every journey.
- Every start and end health readback reports the commit above.

## Attempts

The proof was declared before the first hosted sign-up: the places, the
inputs, one commit, and the pass criteria. No criterion was changed
afterward. Two attempts failed for product reasons and were fixed in the
product:

1. Commit `2fbce717c`: both hosted PDFs lacked the high-injury map. The
   hosted site had never used its browser engine for PDFs
   (KI-2026-11-14-301). Fixed by PR 478.
2. Commit `1fbfe95ed`: the report passed, and the SS4A packet printed
   Appendix C's caveat two pages past its heading, where the declared check
   does not look (KI-2026-11-14-302). Fixed by PR 479, in the product; the
   check was left as it was.
3. Commit `ccf88a921`: all three journeys completed and the checker accepted
   the record.

## Limits

The record states each of these, and the checker requires the first four:

- No PDF/UA check was run on the exported PDFs.
- No keyboard-only or screen-reader pass was made.
- No planner reviewed whether the PDFs are useful.
- FARS records fatal crashes only, so the Nevada county and the tribal area
  counts omit serious injuries.
- Crash counts were compared with the source's published files for Lincoln
  County only (see below).
- The SS4A section text was written by an agent from public sources and says
  so in its first sentence. No county or tribe prepared, reviewed, adopted or
  submitted it, and it speaks for none of them. The comments in the campaign
  were entered by the proof run and represent no one.
- The benefit-cost ratio rests on one treated segment, one assumed crash
  modification factor and an incomplete cost. It shows that the screen and
  the export work, not that any project is cost-effective.
- The PDFs carry the product's own `[VERIFY]` markers on items it did not
  read from a primary source.
- The checker re-reads every text item in each PDF but does not render the
  map page again. That the map is drawn on the recorded page rests on the
  journey's count of highlight-colored pixels there and on a separate render
  of all six pages (100 to 674 such pixels on each map page, none on each
  PDF's first page).
- The hosted site prints PDFs in one font family.

## Source check

Lincoln County, Nevada: the 12 fatal crashes the hosted journey stored (6 in
2022, 4 in 2023, 2 in 2024; 12 people killed) are the same 12 state case
numbers that NHTSA's FARS national annual files hold for state 32, county 17
(`https://static.nhtsa.gov/nhtsa/downloads/FARS/<year>/National/FARS<year>NationalCSV.zip`,
read on November 14, 2026 with a script that uses no OpenPlan code). NHTSA's
query service answered HTTP 403 to an automated request, so this compares
OpenPlan with the published files it reads, not with a second NHTSA product.

## What this does not change

A proven job entry does not change the status of any of the registry's 99
dimension entries. Whether `artifact/safety-evidence` or
`artifact/grant-application` should move is a separate review, recorded when
it happens.
