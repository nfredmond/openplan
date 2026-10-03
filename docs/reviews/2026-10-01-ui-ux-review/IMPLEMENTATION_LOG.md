# UI/UX review implementation log

Work happens in the worktree `~/.local/state/openplan/ui-ux-2026-10-01` on branch `work/ui-ux-review`. Nathaniel delegated the design decisions in section 7 of the review on October 1, 2026, and accepted the recommendations as written.

## Phase 0, October 1, 2026

Checks run in the worktree: `npm run lint` (clean), `npm run deadcode` (exit 0), `npm test` (16,641 passed, 1,173 skipped), `npm run build` (exit 0). Not run: `test:provider-connector`, the live RLS gate and `npm audit`. None of the changes touch a worker, a policy or a dependency.

Browser checks ran against a dev server started from the worktree on port 3210 (`/proc/<pid>/cwd` confirmed), as the local test account, at 1440 and 390 pixels wide. The dev server did not pick up stylesheet edits until `.next` was removed and the server restarted.

| # | Fix | How it was checked |
|---|---|---|
| 1 | Secondary and destructive buttons use paired token ink. Cause of KI-2026-09-05-062 | Chrome, dark mode: "Generate the report packet" computes rgb(240,237,230) on rgb(26,34,38), 13.81:1. New guard `ui-primitives-use-token-ink.test.ts` fails when the old class is restored |
| 2 | Auth callback keeps a query string on `next` | New `auth-callback-destination.test.ts`; fails with `/dashboard%3Fintent=modeling` when the old assignment is restored. Not exercised through a real confirmation email |
| 3 | Portal name hint says the name appears publicly once approved (English and Spanish) | Read in source. Spanish wording was written by the model and has not been reviewed by a Spanish speaker |
| 4 | Attribution control on the seven maps that had none | Chrome: one attribution control on the dashboard backdrop, Corridor Analysis, Aerial and the portal. On non-map pages the backdrop's control sits under the rail; Phase 2 removes that backdrop |
| 5 | The tract paint expressions draw a null value in a no-data grey, with a legend entry | Three pinned tests updated and one added. Not checked on screen against a tract with a missing value. **Corrected October 2:** this row first claimed that missing tract values now draw grey. That was broader than the evidence. The paint expression was fixed, but the data layer still turned a suppressed or absent Census value into zero before it reached the map. The independent review fixed that for the four rate overlays and recorded the remaining limits in `docs/reviews/2026-10-01-independent-fixes/MAP_DATA_FIXES.md` |
| 6 | Corridor Analysis rail readable in light mode | Chrome, light mode: tile values, heading and select compute rgb(240,237,230) |
| 7 | Stat tile grids size to their container; grants catalog uses one column | Chrome at 1440: grants 7 tiles in 3 columns, project page 4 tiles in one row |
| 8 | Sign-in form before the marketing text on phones | Chrome at 390 by 844: email field at 425 pixels, submit button ends at 662 |
| 9 | Skip link and one `main` landmark per page | Chrome: first Tab focuses "Skip to main content"; Enter moves focus to `#main-content`; one `main` on the dashboard and the portal |
| 10 | Portal error and loading pages | Compiles and builds. The error page was not triggered in a browser. **Corrected October 2:** my first wording told the resident that the problem was on our side and that anything already sent was received. The page has no evidence for either statement. The independent review removed both and made the retry button reload the page, because resetting the boundary alone kept a failed server response (`docs/reviews/2026-10-01-independent-fixes/UI_RECOVERY_FIXES.md`) |
| 12 | Language picker is one row that opens to 44-pixel links | Chrome at 1440 and 390: closed row reads "Language English"; 22 links, 44 pixels tall |

## Still open from Phase 0

- A closed or archived campaign still returns the generic 404 (P4). It needs a read-only results page, which is new behavior and belongs with the portal work in Phase 6.
- Favicon, PNG social image and scaffold file removal (P10). These wait on the wordmark in Phase 6.

## Phase 1, first batch, October 1, 2026

Checks in the worktree: lint clean, dead-code check exit 0, 16,742 tests passed, production build exit 0. Browser checks on port 3210 from the worktree, dark and light, 1440 and 390 pixels wide.

| Change | How it was checked |
|---|---|
| Type floor. Added `text-label` (12px), `text-compact` (13px) and `text-reading` (17px). Moved 624 component uses and 77 stylesheet declarations under 12px onto the floor, and 197 more onto `text-compact`. Wide letter-spacing (0.16em and up) became 0.12em so labels did not grow wider | Chrome: zero text elements under 12px on 15 of 16 sampled pages, down from 89 to 268 per page at 390 pixels. New guard `type-scale-has-a-floor.test.ts` fails when a 9.9px badge is restored |
| `cn()` knows the new sizes are font sizes | Unit test in the same guard. Without it tailwind-merge drops `text-label` when a colour class follows |
| Status colours (`--status-ok`, `-warn`, `-urgent`, `-info`) are fixed in both modes and no palette overrides them. The status badge uses them | Three tone tests updated to the new classes; each failed first, so each still detects a tone change. Seen on screen in both modes |
| Always-dark surfaces (operator card, Corridor Analysis shell, studio panels, public rail, Planner Agent drawer) take dark token values in light mode | Chrome, light mode: the "Next" badge on the grants operator card and the Corridor Analysis rail are readable. `surface-text-stays-legible` was taught to find `.dark` inside a selector list; it failed first with "expected 4 to be greater than or equal to 5" |
| Input and select borders at 3.2:1 or better | Token change; contrast calculated, not measured in a browser |
| Light Cartographic accent #c03f1c (was #e45635) and warning text #8a5a00 (was #b78018) | Calculated: white on the accent is 5.29:1, accent on the page background is 4.68:1 |
| Grid children may shrink below their content | Chrome at 390 pixels, elements pushed past the right edge: grants 648 to 117, one project 391 to 2, one program 295 to 4, one model 325 to 62 |
| One global reduced-motion rule | Read in source. Not exercised with the setting on |

Known gaps from this batch:

- The generated model charts (`src/lib/models/charts/`) still set 10 and 11px text inside fixed-width SVG. The floor guard does not read SVG attributes. Phase 5 covers charts.
- The other four palettes were not looked at after the accent and status changes.
- One hydration warning appears on a model page in light mode. It was not traced, and I did not establish whether it predates this work.

## Phase 2, the page frame, October 1, 2026

Decision D1 as approved: ordinary pages no longer float over a wallpaper map.

Checks in the worktree: lint clean, typecheck clean, dead-code check exit 0, production build exit 0, 16,771 tests passed with one guard failure fixed afterward (a dialog `id` that the class-name guard read as an unstyled class; renamed and re-run green). Browser checks on port 3210 from the worktree at 1440, 1024, 800 and 390 pixels wide, dark and light.

| Change | How it was checked |
|---|---|
| The shared background map mounts only on the route that reads it (the Aerial index). Every other page has no map instance, tiles or feature requests behind it | `safety-owns-the-only-map` and three backdrop tests updated to the route where the map now mounts. Chrome: no Mapbox attribution or canvas on the dashboard |
| Plain shell: rail and header attach to the window edges; the page is solid, edge to edge, centered at 92rem. The rail opens over the page on hover and no longer pushes it sideways | Chrome at 1440, 1024 and 800 |
| The Planner Agent button sits in the header. The account card sits at the foot of the open rail; with a collapsed rail, sign-out is in the header | Chrome at 1440 and 1024 |
| Phone frame on every route: one 56px header row (workspace, search, Planner Agent), a bar with up to four named destinations and More, and a More sheet that lists all 20 destinations by name with appearance and sign-out | Chrome at 390 by 844: page area 390 by 732, 87 percent of the screen (was 358 by 568, 62 percent). Bar buttons 89 by 52 (were 48 by 23). A real tap on More, then Grants, reached `/grants` and closed the sheet with no console errors |
| Rail rows have a 24px floor | Read in source |

Known gaps from this batch:

- Safety and the Aerial index keep their own desktop layouts. The Aerial index on a phone starts its page 244px down to clear the map dock. Both change when those pages move to the shared map shell in Phase 3.
- Corridor Analysis still draws its own bordered shell inside the page.
- `qa-harness/openplan-local-control-hit-test-audit.js`, `-escape-hatch-audit.js` and `-card-nesting-audit.js` were not run against the new frame.
- The workspace clock under the workspace name is hidden in the plain shell.
- Keyboard order through the new header and the More sheet was not walked by hand.

## Phase 3, first step, October 1, 2026

| Change | How it was checked |
|---|---|
| The "Can OpenPlan do this here?" panel on a project page is one row that opens (decision D5). The status badge stays visible on the closed row | Chrome at 1440 and 390, dark and light: the project title is followed by the row and then the project's own tabs. Panel tests pass unchanged because the full panel is still the default elsewhere |

Checks: lint clean, dead-code check exit 0, 16,772 tests passed.

After screenshots are in `evidence/` as files 17 to 21.

## Phase 3, record hubs, October 1, 2026

Decision D2 as approved: record pages share one layout. Nathaniel said "go for next steps, you're the boss" before this batch.

Checks in the worktree: typecheck clean, lint clean, dead-code check exit 0, production build exit 0. The full suite reported 22 failed files in the first run: 20 timeouts and one worker-process spawn timeout while the machine load average was 18 from other sessions, and one real failure (the jargon ledger count for "record" fell from 265 to 263 because two header kickers were removed; the baseline was lowered as the guard instructs). The 22 files were re-run alone: 22 passed, 670 tests.

| Change | How it was checked |
|---|---|
| `RecordHubHeader`: breadcrumb, title, one status line, description. Not a card | Used by four pages; seen in Chrome |
| Plan, program, model and scenario set pages: header plus URL tabs. Plan: Overview, Linked work, Edit plan. Program: Overview, Funding, Linked work, Edit program. Model: Runs (default), Overview, Edit model, with the "No validated screening run" banner above the tabs. Scenario set: Overview, Alternatives, Comparisons and reports, Edit scenario set | Each page's own tests pass with no assertion changed. Chrome at 1440 dark and 390 light on all four. Three of the four conversions were done by helper agents from the plan page as the reference; I reviewed their reports, typechecked and looked at each page |
| The workspace-wide command board and its data load are removed from the plan and program pages | Read in source; page tests pass |
| The four pages are registered in the tab guards (`page-tabs-guard-source.ts`), so deep links into them are checked | The guards failed first on two real findings, both fixed: two model maps did not re-measure when their tab opened (`keepMapSizedToContainer` added), and links into `/programs/<id>/work-program#...` were counted as links into the program page. The link pattern now takes one path segment; a before and after comparison showed it drops exactly those four links and no others across all eight registered prefixes |
| Page-level grid children may shrink, so a long tab strip scrolls sideways on a phone instead of widening the page | Chrome at 390: the scenario title wraps and zero elements sit past the right edge |
| Dashboard has a page title, "Overview" | Chrome; dashboard tests pass |
| Theme provider renders the server default first and adopts the stored mode and palette right after | Chrome: the light-mode hydration warning on the model page is gone; a stored light mode and Harbor palette load without change, and a switch to dark persists across reload |
| New mark, favicon, touch icon and PNG social image rendered from `public/openplan-og.svg`; five scaffold SVGs removed; the "Nat Ford Planning" credit is not on the new social image | `public-metadata.test.ts` updated and passing. Not checked in a link-preview tool |
| Sign-in, sign-up, reset and invitation pages have their own tab titles | `every-page-titles-its-own-tab` passes |

Known gaps from this batch:

- Closed tab panels still mount (the `PAGE_TAB_PANELS_UNMOUNT_WHEN_CLOSED` flag is unchanged), so a record page still renders every tab's content.
- The engagement campaign, RTP cycle and report pages keep their older headers.
- On the model page, an empty state still says "Use the Links tab"; that tab is now inside "Edit model".
- The footer on public pages still credits Nat Ford Planning.

## Index pages, forms, public pages and Corridor Analysis, October 1 to 2, 2026

Four helper agents worked in the same worktree on separate files; I reviewed each report, reconciled the shared guard, typechecked, and looked at the pages. Checks on the combined tree: typecheck clean, lint clean, dead-code check exit 0, production build exit 0, 16,844 tests passed with one failure fixed afterward (see the smoke-script guard below) and re-run green.

| Change | How it was checked |
|---|---|
| `PageHeader` on eight index pages (Projects, Plans, Programming Cycles, Reports, Regional Plan, Travel modeling, Scenarios, Engagement): title equal to the rail label, one sentence, stat tiles under it. The two-card header, its kicker and the static explainer bullets are gone. The "New" button opens the wizard directly. The workspace command board is off the plans, programs and reports index pages | Chrome at 1440 dark on all eight and 390 light on three. `every-module-has-one-primary-header-action` rewritten for the new header with its negative controls re-run (id removed, click handler removed, second primary added, creator moved out of the header, stray intro card: each failed as expected) |
| Travel modeling keeps "Start project comparison" as its primary action; "New model record" is secondary. A helper had swapped them; I restored it and added a `page-header-link` row kind to the guard, which fails when the link target is broken | Guard run with the href broken: failed; restored: passed |
| The wizard's own header is a `div`, so it no longer nests a `header` inside the page header | Wizard tests pass |
| 69 form controls labeled (50 in the land use plan workbench); inline errors in 62 files now carry `role="alert"`, and 9 success lines carry `role="status"` | The helper's related test run; one test query changed from placeholder to label. Not checked with a screen reader, and the workbench's new visible labels were not looked at |
| Closed campaign: `/engage/<link>` shows only "This comment period has ended" with no campaign content. The first version re-published the title, comments and commenter names; I had it narrowed, because Closed is how staff take a campaign offline and Active with submissions closed already exists for a public read-only state. Staff copy now says what the link shows. Draft, archived and unknown links stay not found | 12 tests, including that the closed read touches only the campaign table for `id, status`. Chrome: a closed test campaign returns the notice, one `h1`, one `main`, no form, and the tab title is the notice |
| Agency-shared pages (public plan, plan document, measure, published plan, land use review) moved to a `(published)` route group with no OpenPlan marketing navigation and one attribution line. A print block scoped to those pages | Tests repointed and passing. Chrome: a shared plan page has no "Create free workspace" navigation, shows the attribution line, and has one `main`. Not printed |
| Sign-up with a live session goes straight in; password rule is a visible line; a failed emailed link gets a plain notice with a resend button; `next` uses the shared same-origin check | Auth tests grew from 11 to 20 |
| Home page says AI drafting uses the agency's own provider key; two unverified time claims removed | Claim guards pass |
| Corridor Analysis fills the page area edge to edge | Chrome at 1440 dark and light and at 390 |
| Report generate button labels are whole literals | `qa-harness-route-contract-guard` had been passing only because an explainer sentence happened to contain "Generate HTML packet". Removing that sentence exposed it; the real label is now visible to the guard |

New Spanish strings written by a model and not yet read by a Spanish speaker: `closed.title`, `closed.body`, `survey.otherAnswerLabel`, `survey.mapNoteLabel`, and the revised `portal.nameHint`.

Known gaps from this batch:

- `qa-harness/openplan-prod-rtp-release-review-smoke.js` still expects the command board and the old "Report packets and exports" heading on the plans and reports index pages. It targets the inactive hosted deployment and was not rewritten.
- Three staff sentences about the public link read slightly off for a closed campaign (publish flow, preview page, the "Portal: Staged" list chip).
- Aerial was not rebuilt as a map-first page.
- Closed tabs still mount. Flipping the flag fails 134 tests in 11 page test files that look for content in closed tabs; they need to render the right tab first.
- The remaining index pages (Grants, Data Hub, Model Validation, Documents, Invoices, Land Use Plans, Aerial, My Work) keep their older headers.

## Remaining headers and widget accessibility, October 2, 2026

Two helper agents converted pages in the worktree; four earlier helpers were cut off by a usage limit with no edits left behind (checked: the tree was clean when work resumed). The session then moved from Fable 5.1 to Opus 5.5 at Nathaniel's request to save Fable usage. Checks on the combined tree: 17,514 tests passed, typecheck clean, lint clean, dead-code check exit 0, production build exit 0. Browser checks on port 3210 from the worktree.

| Change | How it was checked |
|---|---|
| `RecordHubHeader` on the engagement campaign, RTP cycle and both report detail pages. The campaign's share-link state stays above the tabs; the moderation tiles moved into Responses. The report's generate control stays above the tabs | Page and `page-tabs-*` tests pass. Chrome at 1440: campaign page header, chips and tabs |
| `PageHeader` on Grants, Data Hub, Invoices & Reimbursements, Land Use Plans (primary link to its form), Model Validation, Documents, My Work, Workspace setup & health and Planner Agent Activity. My Work puts the queue first and reminder settings in a closed disclosure | Page tests pass; header-action guard has a new `page-header-link` row for Land Use Plans. Chrome at 1440 on all nine: no overflow, no console errors |
| The workspace command board is off every record page and the project overview | Read in source; tests pass |
| Data Hub build notes removed ("automation theater", "Why this slice matters", "Visible system component", "policy diffing ... later"); the LODES card that became empty is removed rather than given a sentence I could not verify | Chrome at 1440 |
| Planner Agent drawer and command palette render through the shared `ModalDialog`. The palette is a combobox with a listbox and announces the highlighted option. Both close on a backdrop press; the drawer will not close while an approval is pending | Chrome at 1440 and 390: drawer docked right at full height, focus held through 40 Tab presses, Escape closes and focus returns to the launcher. Palette: Ctrl+K focuses the input, arrows move `aria-activedescendant`, typing and Enter navigated to /grants. New `command-palette.test.tsx` fails when `aria-activedescendant` or the backdrop close is removed |
| Workspace switcher is a plain disclosure list (it claimed listbox roles with buttons inside options); Escape closes it and returns focus; the current workspace has `aria-current` | New test fails when the focus return is removed |
| Layer delete answer is a focused named group instead of a `role="dialog"` that never took focus | Existing tests pass |
| Loading skeleton announces "Loading" in a status outside the hidden placeholder; data table scroll area is a keyboard-reachable region; selectable rows select from a real button | Tests updated; the row test now presses the button |

Not done in this batch: closed tabs still mount; Aerial is not map-first; the hosted-only smoke script `openplan-prod-rtp-release-review-smoke.js` still expects the removed command board.

## Browser audits against the new frame, October 2, 2026

Nathaniel refreshed the walkthrough instance on port 3000 to `32dbc44b`; `which-openplan.sh` from this worktree confirmed the match. The four `qa-harness` browser audits ran for the first time against the new page frame: first on port 3000, then, after fixes, on a production build of this worktree served on port 3211. The dev server was not usable for this, because Safety never reaches network idle under `next dev`.

| Audit | First run | Change | Final run |
|---|---|---|---|
| Control hit-test (dashboard, Safety, projects at 1440 and 390) | 5 covered | Three were slivers: controls with under a pixel showing at a scroll panel's edge, whose aim point the browser rounded onto the neighbor. The audit now skips a control with less than 8px showing (`tooThinToJudge`, unit checked; the check fails if the threshold swallows a fully shown, covered control). The other two were Safety's Mapbox logo, under the rail and then under the account card. It now sits past the rail and above the bottom chrome strip. Mapbox requires it visible | 0 covered, exit 0 |
| Escape hatch (Safety, Corridor Analysis, Overview, Projects, a resident portal) | Pass | None | Pass |
| Map reading | Failed: no "Read the map" control on Safety | The audit's default route was stale; Safety has owned its map since August and the control lives on the Aerial index. Default changed to `/aerial` | Pass: 10.4% of the window is map with the page showing, 70.4% in map-reading mode |
| Card nesting | 19 findings: 15 better than budget, Grants 5 deep with 16 boxes past the limit, Help 207 characters per line | Grants opportunity notes became labeled rows and its evidence boxes became ruled sections; the modeling decision box, the reports funding follow-through box and the RTP registry's queue boxes became rules. Help became a reading column (38rem, 16px body). Budget re-seeded; no route got worse | Every route matches its budget, exit 0 |

Re-seeded budget, before and after: RTP depth 6 to 3 and deep boxes 26 to 0; Reports deep 4 to 0; Overview deep 1 to 0; Help depth 3 to 0. Part of every route's drop is the plain frame no longer drawing a box; the budget's note says so.

Not covered by these audits: keyboard order through every page, screen readers, the other four palettes, and real data volumes.

## Map colour, October 2, 2026 (review findings M5, M7 and M8, in part)

Checks: 17,525 tests passed, typecheck, lint and dead-code check clean. Production build of this worktree served on port 3211; maps looked at in Chrome at 1440.

| Change | How it was checked |
|---|---|
| Corridor screening scores are painted from one shared ramp (`lib/cartographic/screening-score-ramp.ts`): one blue from dim to bright, interpolated from 0 to 100 with no cut points; a withheld score is grey. It replaces two different red-to-green ramps with cut points at 40, 60, 75, 90 and at 45, 70, which contradicted the adopted presentation research (no validated bands, no good or bad reading) | New `screening-scores-are-not-banded-on-maps.test.ts`; restoring the old corridor ramp fails three of its five tests. Not seen on screen: the test workspace's Corridor Analysis page showed no scored corridor |
| The model run list reads its overall score through the shared presentation rule, so a composite whose inputs were missing is withheld there too, and the badge is neutral ("Screening score N/100") instead of green | Model run tests pass |
| Traffic volume map uses fixed classes (under 5,000 to 40,000 and over, daily PCE) shared by the lines and a numbered legend, in a colour-blind-safe ramp. It used to stretch red-to-green between zero and each run's busiest link, so colours did not compare across runs, and the legend said only "Low" and "High" | New `traffic-volume-classes.test.ts` evaluates the paint with Mapbox's own expression engine; shifting the paint breaks away from the legend fails it. Chrome: legend and lines match |
| The volume route reports how many links existed before it kept the busiest 5,000, and the map says "The busiest 5,000 of 130,685 road links ... Quieter roads are not drawn." Without it, a map of only the busiest links read as a region where every road carries 30,000 or more | Chrome, on the test workspace's run. No route unit test exists; the route's database and storage reads were not mocked for this |
| Model-agreement map uses Okabe-Ito blue, orange and vermillion with its existing line patterns. Green on "agree" read as "correct", and agreement is not evidence of accuracy | Agreement map tests updated to the new colours and pass. Chrome: classes distinct on the dark basemap |

## Tract colours and withheld scores on Corridor Analysis, October 2, 2026

Checks: 17,542 tests passed, typecheck, lint and dead-code check clean. Production build of this worktree on port 3211, Chrome at 1440.

| Change | How it was checked |
|---|---|
| Census tract measures (minority share, poverty, median income, zero-vehicle households, transit commuting) are defined once in `lib/cartographic/tract-measure-classes.ts`: five classes each, one purple from dim to bright, painted with `step`. The map paint, the legend and the inspector's "hovered" row all read it. Before, each measure had its own multi-hue ramp (poverty ran green to red), the map blended between stops while the legend listed classes, and the inspector carried a third copy of the breaks | New `tract-measure-classes.test.ts` evaluates every class at both edges with Mapbox's expression engine; switching the paint back to blending fails 10 of 12. The independent review's zero-versus-missing test (`census-overlay-availability.test.ts`) passes unchanged. Not seen on screen: the test workspace has no saved run with tract data |
| Corridor Analysis applies the score presentation rule when it loads a result. A run saved on 2026-08-20, with crash and transit data unavailable, showed "Overall 32" and "Accessibility 45"; both are withheld under the rule adopted 2026-08-24. New `withPresentedHeadlineScores` (display copy only; the page writes back only map view state) | New unit test built from that run's real shape. Chrome: no 32 or 45 anywhere on the page |
| Its saved prose summary and saved interpretation, which both said "Overall: 32/100", are withheld with the same notice reports already use (`presentRunSummary`) | Chrome: the notice names the three conflicts; the raw score text is gone |

## Withheld scores everywhere else they appear, October 2, 2026

Checks: 66 targeted tests in 7 files, run on one worker, and lint on the changed files. The full suite was not run for this batch: two attempts pushed this machine to 7 of 7 GB swap and crashed it while other sessions were running. GitHub CI runs the full gate after the push.

| Change | How it was checked |
|---|---|
| The dashboard chart "Composite score by run" read the raw overall score. It now reads `scoreValueForPresentation`, so a run whose crash or transit data was unavailable drops out of the chart instead of plotting a composite the rule withholds | New test in `dashboard-insights.test.ts` built from a legacy run (raw 32, crash and transit unavailable). Reverting the reader fails it |
| A managed model run's result summary now records, for each headline score, the presented value and whether it is eligible (`scorePresentation`). The raw numbers stay in the record | New `screening-scores-carry-their-eligibility.test.ts`, 3 tests. Removing the record from the comparison metrics fails 1 |
| The scenario comparison board coloured a higher overall, accessibility, safety or equity score green and a lower one red. The four scores are now neutral, because the rule allows no good or bad reading of a score. The board reads the eligibility record when a summary carries one | `scenario-comparison-board.test.ts` asserts the four tones. Restoring the green tone fails it |

Limit: managed run summaries written before this change carry no eligibility record, so the board still shows their raw numbers. Not checked in the browser for this batch.

## Closed tabs, October 2, 2026

Checks: 743 tests in 48 files (every page test that renders a tabbed record page, plus the tab, copy and class-name guards), run on one worker; lint on the changed files; production build of this worktree with its type check, on port 3211; Chrome at 1440 and 390. The full suite was not run locally, for the reason given in the previous section.

| Change | How it was checked |
|---|---|
| Each record-page tab is wrapped in React's `Activity` (`components/ui/page-tab-panel.tsx`). The server leaves closed tabs out of the HTML; once the page runs, React renders them hidden and keeps their state. Before, every tab was in the HTML and hidden with a class. The project overview page drops from 576 KB on main to 454 KB. The page's data payload still carries every tab, so that is the whole saving | `page-tabs-nav-and-panels.test.tsx`: the closed panel is hidden, it is absent from server HTML, and a typed draft survives closing and reopening its tab. Returning nothing for a closed tab fails 2; leaving it visible fails 2. Chrome: sizes measured on port 3000 (main 32dbc44b) and 3211 |
| A draft survives a tab switch. Unmounting closed tabs, the plan in the review, would have lost it; the engagement page relied on this | Chrome at both widths: text typed in the project's RTP rationale field on Overview is still there after Delivery and back |
| A map in a closed tab is not started. The engagement Responses maps start when that tab opens and are removed when it closes | Chrome: no map elements on Record, two drawn on Responses, none after moving to Setup, two again on return; no page errors |
| 230 page tests in 11 files now open the tab that holds what they check. Before, they found content in closed tabs. Negative checks that passed only because their tab was closed now run on the tab where the text would appear, or on every tab. Two order checks on the engagement page became per-tab placement checks, because those sections are never on screen together | Each file was mutated by pointing a changed test at a wrong tab; each failed on the missing content and passed after a harmless edit. **Correction, same day:** those runs used a version that returned nothing for a closed tab. Under `Activity`, jsdom keeps closed tabs in the page, hidden, so a wrong-tab test passed again (checked on the plan page). Fixed in the next section |
| "Open invoice lane" on a project's Delivery tab pointed at the invoice list on the Funding tab and went nowhere. It now reads "Open invoices" and opens the Funding tab at the list | Chrome at both widths: lands on `?tab=funding#project-invoices`, list at the top of the window. The jargon count for "lane" fell from 54 to 53 and the baseline was lowered |
| The engagement banner for comments awaiting review told the reader to use "the moderation sections below", which are on the Responses tab. It now has a "Review comments" link to Responses, shown on every other tab. Its title no longer uses a dash | Two new tests; showing the link on Responses fails one, pointing it at Setup fails the other. Not seen on screen: no live campaign in the test workspace has comments waiting |

Found while doing this (fixed in the next section):

- Plan page: the "Linked work" tab is marked unreadable only for scenarios, campaigns and reports, not for linked projects or supporting models. The banner above the tabs still names every failed read.
- Plan page: "No explicit links yet" points to the "Plan record workflow panel", which is now the "Edit plan" tab.
- Report page: when the stage-gate log cannot be read, the History tab drops the stage-gate row without saying why; the explanation is only on Packet.

## Page tests check the tab again; plan and report tab warnings, October 2, 2026

Checks: 746 tests in 48 files on one worker, then the plan, report and tab-guard files again after the last edits; lint on changed files; dead-code check clean. No browser pass for this batch: the changes are a test stand-in and tab warning lists, and the warning marks were seen in the previous batch's journey only in their passing state.

| Change | How it was checked |
|---|---|
| New test stand-in `src/test/helpers/open-tab-only.tsx` renders only the open tab. The 11 page-test files that render a tabbed page use it, so a test passes only when it opens the tab that holds what it checks. The real panel's hiding, server omission and draft keeping stay covered in `page-tabs-nav-and-panels.test.tsx` | Pointing the plan readiness test at the Edit tab now fails (it passed under the real panel). Inverting the stand-in to render only closed tabs fails 172 tests across 10 files; the eleventh checks only content above the tabs. A harmless edit to the stand-in keeps all 246 passing |
| Plan page: tab definitions move to `plans/[planId]/_tabs.ts` (`buildPlanTabs`), registered with the read-failure wiring guard. "Linked work" now names failed reads of linked projects, supporting models, their link sets, the plan's own links and the scenario, campaign and report statistics; "Overview" names readiness checks and the plan's own links. Before, only scenarios, campaigns and reports marked the tab | Two new page tests. Dropping either model lane fails its test; wiring the models flag to `false` fails the guard and the test; reordering lanes passes |
| Plan page: "No explicit links yet" pointed to the "Plan record workflow panel". It now says to use the Edit plan tab | Existing empty-state tests pass |
| Report page: the History tab now names a failed read of the live stage-gate board or the project's crash evidence, in the notice above the tabs and with a mark on the tab. Before, History dropped the stage-gate row without saying why | Three report tests gained the History mark, plus one new crash-evidence test and a control. Wiring the flag to `false` fails the guard and two tests; dropping either lane fails its tests |
| The notice "Reads that failed behind a tab" joined each tab to its list with an em dash. It now uses a colon ("Funding: funding awards"). The stage-gate sentence on the report page also loses its dash | `page-tabs-url-and-anchors.test.ts` pins "Funding: funding awards"; restoring the dash fails it |

## Aerial index beside the map, October 2, 2026 (review finding M4, in part)

Checks: Aerial, camera, map and copy tests (80 files) on one worker; lint on changed files; dead-code check; production build of this worktree with its type check, on port 3211; Chrome at 1440, 1100, 1024 and 390; the repo's map-reading and card-nesting audits.

| Change | How it was checked |
|---|---|
| The Aerial index page panel ran from the rail to the layer controls, so the mission areas the shell map draws were under it. On screens 1024px and wider the panel is now a sidebar (`SurfaceBesideTheMap`, "THE PAGE AS A SIDEBAR BESIDE THE MAP" in `cartographic.css`) and the map fills the rest. Below 1024px nothing changes | Map-reading audit on `/aerial` at 1600 by 900: map visible with the page showing went from 10.4% (main, port 3000) to 48.1%; reading mode unchanged at 70.4%. A test fails if the page stops setting the mode |
| The two-card header with four stat tiles became the shared page header with one row of four counts; the six-column mission table became a list that fits the sidebar. Failed reads still print as "count unavailable", a dash per count, or "Evidence packages: unknown" | Existing register tests pass with two wording updates. Card-nesting audit: `/aerial` nesting fell from 3 to 0; budget lowered in `fixtures/card-nesting-budget.json` |
| Each mission with a drawn area has "Show on map". It switches the mission-areas layer on and moves the map to the area. On a screen narrower than 1024px it also opens "Read the map", because the page covers the map there. A mission without an area says "No area drawn yet" | New `aerial-index-sends-the-map.test.tsx` and two register tests, including a check that the page selects `aoi_geojson`. Seven targeted breaks each fail one test. Chrome: at 1440 and 1100 the area lands in the open map; at 390 reading mode opens on it |
| A map move now pads for the sidebar on the left and the layer controls on the right (`applyFitInstruction` takes insets; with none, its calls are unchanged) | Tests for both insets; dropping either fails a test. Chrome at 1440: the area sits between the sidebar and the layer panel |
| From 1024 to 1100px the header's appearance buttons sat on top of the "Read the map" card. This was also true on main. In sidebar mode the map controls now start below the header | Chrome at 1100: no overlap. Every control in the sidebar is the top element at its centre at 1440, 1100, 1024 and 390; the same check with a covering sheet reports all 11 covered |
| "Aerial Ops" became "Aerial Imagery" in the mission page's back link and page titles, matching the rail (review finding N3) | Text change |

Not done here: the mission page still boxes its map at a fixed height. That is the other half of M4.

## Aerial mission page as a record with its map first, October 2, 2026 (rest of review finding M4)

Checks: 1,061 tests in 88 files (mission, Aerial, tab guards, map guards, copy guards and every tabbed page test) on one worker; lint on changed files; production build with its type check, on port 3211; Chrome at 1440 and 390, arriving from the Aerial index by clicking.

| Change | How it was checked |
|---|---|
| The mission page was six stacked boxes beside a facts column, with the map fourth, in a 420px box. It is now a record: the shared record header, then tabs for Map, Flight plan, Photos, Processing and Evidence (`aerial/missions/[missionId]/_tabs.ts`). It opens on Map, with the mission map beside the facts column. The map's canvas measured 754 by 612 at 1440 by 900 | New tests: the page opens on Map with the map in it; Flight plan links to `tab=plan`. Defaulting to Flight plan fails one. Chrome: each tab opens with its own content, no horizontal scroll, no console errors |
| The mission map now draws the mission's area to fly: a faint fill under any imagery, an outline over it, its own toggle, and the camera frames it. Before, a mission with an area but no imagery showed "Nothing to place on a map yet" | Four new tests in `aerial-mission-map.test.tsx`. Five targeted breaks (area not drawn alone, not framed, outline under the imagery, toggle inert, no validation) each fail. Chrome: the area is drawn on the Map tab at both widths |
| Each tab names the reads that failed behind it: Map (the imagery preview, evidence packages), Processing (jobs, files held from each job), Evidence (packages). The builder is registered with the read-failure wiring guard and the tab guard table | Two new tests; wiring the jobs flag to `false` fails the guard and a test; dropping the Map packages lane fails a test after its check was tightened (the first version passed with the lane removed, because the preview alone marks the tab here) |
| Section headings in plain words: "Mission AOI & export" is "Area to fly", "Survey flight plan & exports" is "Flight plan", "Packages" is "Evidence packages" | The evidence smoke (`qa-harness/local-aerial-evidence-smoke.js`) now opens each tab for what it checks. Not run: it writes users and missions into the local database the walkthrough instance uses |
| The mission map and the flight-plan editor keep their maps sized to their containers, as the tab guard requires of any map inside a tab | `page-tabs-maps-are-resized.test.ts` passes for both |
| The "Ready for project/report/grant attachment" badge ran past the facts column's edge. It wraps inside the column now | Chrome at 1440 |
| Mission tests open the tab they check, using the open-tab-only stand-in | 81 mission page tests pass |

Also in this stretch: the tab guards were reading the plan page's tab list from a declaration 4bf1f907 had moved into `_tabs.ts`, so three guard files failed on main (CI run for 4bf1f907). Fixed in 577f2370, which reads the plan tabs from `buildPlanTabs`; a planted link to an unclaimed plan anchor fails the guard again. I had not rerun those guards after the move.

## Numbers that read the same everywhere, October 2, 2026 (review finding M10)

Checks: the full suite, 17,578 tests, passed on this machine on two workers with a memory watchdog (the earlier crashes were from the default worker count); lint on changed files.

| Change | How it was checked |
|---|---|
| 286 number and date formatting calls named no locale (`toLocaleString()`, `toLocaleDateString(undefined, ...)`, `Intl.NumberFormat(undefined, ...)`), in 113 files. They formatted in the locale of whatever machine ran them, so a server render and a browser re-render could print the same figure differently. All are pinned to "en-US", the locale `lib/money/format.ts` already uses. The resident portal formats in the resident's language through `portal-i18n/format.ts`, which passes that language explicitly | New guard `numbers-read-the-same-on-every-machine.test.ts` walks `src` and fails on any locale-less call outside comments. A planted locale-less call fails it; a planted pinned call passes |
| An opportunity with no expected award recorded showed "Likely $0" on the grants registry, the program pages and the award-conversion list, and "$0" in the workspace summary's lead award. It now reads "Not set", as the neighbouring chips do | New test in `grants-opportunity-registry-card.test.tsx`; putting "$0" back fails it |

Not changed: the review counted `formatCurrency` defined 14 times. All 14 are short wrappers over the one shared `formatMoney`, so the money itself is already formatted one way. Several wrappers still print a missing amount as "$0"; their callers pass totals or choose `?? 0` themselves, so each would need its own reading before changing. Dates still render in the clock of the machine that formats them; pinning the locale fixes digits and separators, not time zones.

## One bar for the engagement panels, October 2, 2026 (review finding M9, in part)

Checks: the shared bar's tests and every test that names the four panels (84), style, copy and chart guards (231), on one worker; lint; production build on port 3211; Chrome at 1440 in dark and light and at 390, on a live campaign's Analysis tab.

| Change | How it was checked |
|---|---|
| The demographics, representativeness, participation and survey panels each drew their own bars, in fixed sky, slate, emerald, amber and rose classes that ignored the planner's palette. They now share `components/ui/chart-share-bar.tsx`, drawn in `--chart-1`, a muted tone for comparison rows (an area baseline), or a category's own colour when the planner chose one | Chrome: the fill follows the palette (one teal in dark mode, a darker teal in light), no console errors. The hand-drawn bar functions and their colour classes are gone from all four panels |
| Demographics drew a band nobody chose as a 4% sliver. A zero is now no fill | New shared-bar test, plus a panel test with a zero band; putting the sliver back in the panel fails it |
| Representativeness drew an unknown share as an empty bar, which read as zero. It now draws nothing, shows a dash in place of the number, and is marked unknown | Shared-bar test; treating unknown as known fails it |
| The empty track was `bg-muted`, which rendered as a solid grey bar, so "Pending 0 · 0%" looked like a full bar. The track is now a faint tint | Chrome, light mode: zero rows read as empty tracks |
| Participation statuses were coloured green, slate, amber and red. Green against red fails colour-blind separation on this palette (measured in `chart-primitives.tsx`); every status now uses one colour and the label says which | Shared-bar tests: a category colour is used only when it is a real hex colour; a share over the whole stays inside the track. Four targeted breaks each fail |

Not done: reports and measures still have no charts (the other half of M9), and the participation intake sparkline is still hand-drawn.

## What is next

1. Charts for reports and measures (rest of M9), using the shared chart primitives.
2. Copy pass. This waits on Nathaniel's vocabulary answers (decision D6).
3. Keyboard and screen-reader walk.
4. The four remaining palettes.
5. A hosted smoke script for the public pages.
6. Spanish strings reviewed by a speaker; the footer credit is Nathaniel's call.
