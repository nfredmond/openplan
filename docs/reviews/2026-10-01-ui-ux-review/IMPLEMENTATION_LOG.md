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
| 5 | Missing tract values draw in a no-data grey, with a legend entry | Three pinned tests updated and one added. Not checked on screen against a tract with a missing value |
| 6 | Corridor Analysis rail readable in light mode | Chrome, light mode: tile values, heading and select compute rgb(240,237,230) |
| 7 | Stat tile grids size to their container; grants catalog uses one column | Chrome at 1440: grants 7 tiles in 3 columns, project page 4 tiles in one row |
| 8 | Sign-in form before the marketing text on phones | Chrome at 390 by 844: email field at 425 pixels, submit button ends at 662 |
| 9 | Skip link and one `main` landmark per page | Chrome: first Tab focuses "Skip to main content"; Enter moves focus to `#main-content`; one `main` on the dashboard and the portal |
| 10 | Portal error and loading pages | Compiles and builds. The error page was not triggered in a browser |
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

## What is next

1. Finish record hubs: the same header on campaign, RTP cycle and report pages; closed tabs unmount; the command board leaves the remaining record pages.
2. One `PageHeader` component for the index pages, with the "New" button opening the wizard directly.
3. Corridor Analysis and Aerial onto one map shell.
4. Copy pass. This waits on Nathaniel's vocabulary answers (decision D6).
5. Chart and map ramps, legends and number formatting.
6. Public pages: wordmark, screenshots, favicon and social image, closed-campaign page, print stylesheet.
7. Keyboard and screen-reader walk; refresh the browser audits against the new frame.
