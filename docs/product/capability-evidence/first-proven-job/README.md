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
refuses them unless every rule in `../README.md` holds. The journeys ran with
the journey script as it stands at the commit above.

## Inputs

What the journeys typed is in `inputs/`: the six SS4A section texts and the
facts behind them for each place, and the budget attachment. Each journey
recorded the SHA-256 of the inputs file it read, and they are these files:

| File | SHA-256 |
|---|---|
| `inputs/sierra-county-ca.inputs.json` | `5f00887cbe5573dc23c2ee038b145bb47859381591b019c02751b84b719079b6` |
| `inputs/lincoln-county-nv.inputs.json` | `a44db134df84e78ac4d6b0bfb3c5039caa22a054ed093384d255abd19411bf7a` |
| `inputs/pyramid-lake-paiute-reservation.inputs.json` | `264c91b172a4db633f841c5b25090307c94d66f28c638477b3e8080db91ce0b3` |
| `inputs/budget-demonstration.csv` | `a38dac9e7b8086dc8bc214c531d31d04278dd445b537731a32cf346fd1b5c32e` |

A fresh-context agent checked every fact in the three files against its
source before the run, and its corrections were applied.

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

Between attempts 1 and 2, one launch of the script stopped before it reached
the hosted site, because it was pointed at a checkout with no dependencies
installed. It made no request and is not counted as an attempt.

## The hand checks declared before the run, and their results

The declaration added four checks the lead would make by hand on the six
PDFs. Three were met and one was not:

- **Email addresses:** none, in the text or the raw bytes.
- **Text from the local rehearsal fixture:** none.
- **Raw timestamps:** no machine-format timestamp. Each plan's cover does
  print its creation time in UTC with no zone named ("CREATED 11/14/2026,
  5:33:55 PM"); the SS4A packets label UTC.
- **Stored codes: not met.** The severity-coverage code the check was written
  for (`kabco_full`) is gone. The PDFs still print other stored identifiers
  as they are kept: `review-required` and `annual-ledger-1` in the
  benefit-cost summary; `source ccrs-ca`, `source fars-national` and a segment
  id such as `road:534444c2:53` in the benefit-cost input table; and, in the
  three plans, template and schema names (`us_federal_aid_stage_gates_v0_1`,
  `programming-eligibility`, `Scope: external_handoff`,
  `openplan.project-jurisdiction-readiness-export.v4`) and repository file
  paths with hashes.

The declaration's formal pass rule is that the checker accepts the record,
and its list of what fails an attempt names a step that cannot complete, a
missing PDF item, a serious axe finding, a leak across workspaces and a
DRAFT stamp. A fresh-context reviewer read the declaration that way and did
not count the stored identifiers as a failed proof. They are recorded here
and in the record's limits as found, not reinterpreted, and
KI-2026-11-14-304 tracks the product fix.

"Finalized by" names "Workspace owner" in all three packets.

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
- The two comments in each campaign were entered by the proof run and say so
  in their own text. Each safety action plan counts them as approved public
  comments toward its engagement component without that label.
- The stored-code hand check was not met (above).
- The checker re-reads every text item in each PDF but does not render the
  map page again. That the map is drawn on the recorded page rests on the
  journey's count of highlight-colored pixels there and on a separate render
  of all six pages (100 to 674 such pixels on each map page, none on each
  PDF's first page).
- The hosted site prints PDFs in one font family.

## What the checker does not catch

A fresh-context reviewer changed one fact at a time in a copy of the record.
The checker refused the changes the lead tried (a PDF hash, a health
readback, a missing journey, a serious axe finding, zero stored crashes in
Lincoln County, a data route answering 200, a DRAFT stamp, a local origin, a
dropped limit, a differing source check). It accepted these, and each is
covered only by other evidence:

| Change the checker accepts | What else shows the truth |
|---|---|
| The map item pointed at another page, or its image hash replaced | All six map pages rendered and counted separately; the reviewer's own render |
| The cross-workspace checks cut to one journey's four | Each journey file holds its own four refusals |
| Each journey's screens cut to one page | The journey files hold all 36 rows per journey |
| A "matched" source check with any web address and note | The case numbers below |
| Sierra County storing one crash and no segments | The PDFs print the real counts |
| A text item pointed at other words on another page | The PDFs |
| No approved comments or staff review in a journey | The PDFs' engagement summaries |
| A place's GEOID changed with its label kept | Stated as a blind category in the checker |
| The tribal area storing zero crashes | No rule requires crashes there; the journey stored three |

KI-2026-11-14-303 lists these for the checker's next change.

### Rechecked with the strengthened checker, November 14, 2026

The checker was then changed to refuse eight of those changes: the map item
pointed at another page, cross-workspace checks cut to one journey, screens
cut to one page, a "matched" source check with any address or a trivial note,
a journey with no crash, ranked segment or countermeasure (which covers both
the California county and the tribal area rows above), a text item that is
not its item's own heading, and a journey with no approved comment or staff
review. This record, unchanged, was run through the strengthened checker with
its six PDFs: it is still accepted. The same eleven changed copies the lead
tried before are now all refused, the wrong map page among them. A test in
the repository (`first-proven-job-record-accepted.test.ts`) repeats this on
every run where Poppler is installed.

Two changes that checker still accepted: a replaced map image hash and a
place's Census id changed with its label kept.

Later the same day the checker began to render the map page itself. For each
map item it renders the recorded page with Poppler's pdftoppm at 72 dpi and
counts highlight-red pixels with the journey's own rule; a page with fewer
than 40 is refused. This record's six map pages hold:

| PDF | Map page | Highlight-red pixels |
|---|---|---|
| California county safety action plan | 17 | 1,012 |
| California county SS4A application | 9 | 1,015 |
| Nevada county safety action plan | 15 | 600 |
| Nevada county SS4A application | 9 | 600 |
| Tribal area safety action plan | 14 | 154 |
| Tribal area SS4A application | 9 | 154 |

Poppler 25.07 on Windows and Poppler 24.02 in an Ubuntu 24.04 container
rendered the same pixel bytes and the same counts for all six pages. Each
PDF's first page and the page of its ranked table hold none, and a copy of
this record with the map item pointed at either is refused. These counts use
the journey's rule; they are not the 100 to 674 of the separate render listed
above, whose settings this file does not record. This record, unchanged, is
still accepted; `first-proven-job-record-accepted.test.ts` repeats the render
and the counts on every run where Poppler's pdftotext and pdftoppm are
installed.

The checker still does not recompute the PNG hash this record carries,
because PNG bytes differ between Poppler builds whose pixels are the same. A
replaced PNG hash is still accepted, but the map no longer rests on it.
Records written from now on also carry a hash of the pixels, which the
checker recomputes; this record predates that field and is not changed. A
place's Census id changed with its label kept is still accepted. Had this
record failed the strengthened checker, its entry would have been withdrawn
from the registry until a rerun passed.

### A limit found while reviewing the second job's checker, November 15, 2026

A review of the second proven job's checker found that a record's origin is
a string its assembler is given, and that the assembler did not read each
run file's mode. The same was true when this record was assembled. Its three
journeys did run on the hosted site: each run file says `mode: proof` and
names the hosted origin and this record's commit, and the files are kept
with the lead's state, not in this repository. The record itself cannot show
that, and nothing in it comes from the deployment. From November 15, 2026
the assembler refuses a run that is not a finished proof run on the
record's origin and commit. This record is unchanged and is still accepted.

## After the run

The five public comment pages the three attempts created were taken offline
on November 14, 2026 at 19:05 UTC, each from its own test account through the
app: each address now shows only "This comment period has ended" and nothing
from the campaign. Until then each was open under its place's name with the
product's standard invitation and no demonstration label. The test accounts
and their workspaces, named "OpenPlan proof run, ... demonstration", remain.

## Source check

Lincoln County, Nevada: after the hosted journey, the case numbers it stored
were read from the hosted database, read-only. The 12 fatal crashes (6 in
2022, 4 in 2023, 2 in 2024; 12 people killed) are the same 12 state case
numbers that NHTSA's FARS national annual files hold for state 32, county 17
(`https://static.nhtsa.gov/nhtsa/downloads/FARS/<year>/National/FARS<year>NationalCSV.zip`,
read on November 14, 2026 with a script that uses no OpenPlan code). NHTSA's
query service answered HTTP 403 to an automated request, so this compares
OpenPlan with the published files it reads, not with a second NHTSA product.

## A limit found after this record was made: colour contrast below the first screen

Added November 17, 2026 (agent-run). This record says each screen it used
had no serious or critical axe-core findings. That reading covered only
what was on the first screen. OpenPlan scrolls an inner pane, not the
page, so the journey's screen check ran axe on a page one screen tall,
and axe-core treats anything below that screen as not applicable for
colour contrast (KI-2026-11-17-032). The record, its files and its other
findings are unchanged, and the checker still accepts it.

On November 17, 2026 an agent read the same screens on a local build
with the whole screen measured, in one stand-in workspace (not this
record's workspaces or commit). Before the colour fixes in PR 520 these
screens held 41 serious colour-contrast nodes: on the project page, 8 in light mode and 11 in dark at each width; on the Safety page, 1 in dark at 1440 px and 1 in each mode at 390 px. After the
fixes they held none. The journeys now measure the whole screen
(`readWholeScreen` in `qa-harness/journey-browser-lib.js`, PR 520). The
screen states that stand-in workspace did not reach are listed in
KI-2026-11-17-071, and a table that scrolls sideways at 390 px is still
not read whole (KI-2026-11-17-072).

## What this does not change

A proven job entry does not change the status of any of the registry's 99
dimension entries. Whether `artifact/safety-evidence` or
`artifact/grant-application` should move is a separate review, recorded when
it happens.
