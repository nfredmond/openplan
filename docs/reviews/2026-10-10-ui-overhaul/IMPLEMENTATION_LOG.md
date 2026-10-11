# UI overhaul implementation log, October 10 to 11, 2026

Plan and independent review: `PLAN.md` beside this file. Each batch below says what changed and how it was checked. Word counts are `innerText` words on the first screen of the local test workspace (`mapaudit@openplan.test`), before and after, at 1440 by 900.

## Step 1. Foundations (PR #186, merged at 06bdc7af)

| Change | How it was checked |
|---|---|
| Body text in Public Sans 2.001, loaded locally from the same pinned Google Fonts commit as the other faces, with license and provenance. Space Grotesk stays for titles (D7) | `font-preload-source.test.ts` rewritten; dropping the Public Sans variable from `<html>` fails it |
| Labels sentence case: uppercase and wide letter-spacing removed from 159 component files and every label rule in the three app stylesheets. Engagement portal, engagement maps and GTFS files left to their lanes | New `labels-are-sentence-case.test.ts`, per file; an uppercase class in `status-badge.tsx` or a `text-transform: uppercase` rule in `cartographic.css` fails it; negative tracking and a similar word pass |
| Badges 24 px rounded tags | Visual, journeys below |
| Colour mode follows the device by default (D3), with "Match this device" beside Light and Dark; a stored choice is kept | New `theme-follows-the-device.test.tsx`; ignoring the device or storing "system" as a value each fail it |
| Rail says Dashboard; Scenarios and Model Validation under Travel modeling (D4) | `nav-registry.test.ts` updated with reasons |

## Step 2. Dashboard (PR #187, merged at f6765e3e)

Words: 2,199 before, 390 after.

| Change | How it was checked |
|---|---|
| Needs you (undated My Work groups plus workspace next steps) and Coming up (60-day date rail, month breaks, today, overdue in words). One list per item | `dashboard-coming-up.test.ts`, `dashboard-page.test.tsx` |
| Coming up reads the coming weeks separately from the overdue backlog: `loadMyWork` gained `dueBefore`, `dueOnOrAfter`, `dueOnOrBefore`, `datedOnly` and `rowsRead`. A capped or failed source is said in words | Unbounding the upcoming read, hiding caps, dropping the failure sentence each fail a test |
| Date-only deadlines are calendar days (`isDeadlinePast`): never overdue the evening before | `a-due-date-is-a-calendar-day.test.ts`; restoring midnight UTC fails 2 |
| Figures refuse failed reads; charts on the main view; "Deadlines by month" replaces "Open work"; a retired or unknown stored chart choice cannot blank the page | `dashboard-chart-view.test.tsx` |
| Removed: workspace card, guidance card, quick links, command board, run history, view switch, agent action card | Page tests updated |

## Step 3. Map pages and words (PR #188)

| Change | How it was checked |
|---|---|
| Safety, Aerial and Corridor Analysis share one frame: solid header, attached rail collapsed to icons, map to the edge. Rail opens only for keyboard focus and the pointer, not a mouse click's leftover focus | Escape-hatch audit passes on /safety; map-reading audit on /aerial 55.6% with the page open (48.1% on Oct 2), 80.7% reading; `safety-map-runs-to-the-edge` unchanged and passing |
| Safety panel tabs (Crashes, Layers, Imports); every caveat on Crashes; layers stay mounted | Three new tests; selection keeping the tab, unmounting layers, moving the standing caveat out each fail |
| Corridor Analysis rail trimmed (2,532 to 929 words) | Corridor Analysis suite |
| New guard `every-map-credits-its-sources` | Swapping a map's AttributionControl fails it |
| Hit-test audit skips controls inside closed disclosures (`checkVisibility`) | Before 2 covered on the dashboard, after 1 (the open chart picker over a chart button) |
| Build notes removed ("Next slice", "Lane C migration" ×5, "Chapter shell", "will layer onto this record model"); new guard `planner-pages-carry-no-build-notes` reads string literals and JSX text | Restoring "Lane C" in JSX text or "next slice" in a template literal fails it; a comment passes; interpolation split is a stated blind category |
| 127 kicker labels above section headings removed from 79 files | Copy, nesting and page suites |
| Figure rows (`FigureRow`) replace tile walls on Regional Plan, Grants, Travel modeling, Projects, Data Hub, Reports, Programming Cycles; each keeps "unknown, not zero" | Projects tests: showing a number for a failed read fails them |
| Grants: three URL tabs; every `/grants#…` link opens the tab holding its target; checks and decision form folded; lead step said once; program catalog details folded (page 9,182 words before; Opportunities tab 3,483 after the catalog fold, measured on the build at cd9258b28, most of it the funding program summaries) | New `grants-links-open-the-right-tab`; three targeted breaks fail it |
| Travel modeling: title first; one line per step (claim step always shows its caveat); published studies below the work in disclosures whose summary keeps the outcome and "No model accuracy conclusion follows." | New published-studies test; dropping either fails it. The strip tests caught a first version that hid the claim caveat |
| Projects, Data Hub, Reports: lists first, tools and detail folded or moved down; report rows keep why a packet is or is not current | Reports tests; removing changed sources or not-ready guidance fails them |
| Invoices opens on the header's workspace instead of "Choose a workspace" | New test; restoring the chooser fails it |
| Land Use Plans setup form folded; My Work notes unboxed; budget sentence shortened | Land use (1,034 tests), My Work and portfolio suites |

Full suite runs (two workers, 6 GB cap): 20,470, 20,472, 20,487 and 20,498 passed across the steps. Every run's remaining failures were the two `mammoth-cli-compatibility` tests, which fail only against the stale nested `argparse` in the shared local `node_modules` (CI installs clean and passes), plus fixes recorded in the commits (`an-import-says-what-area-it-covered` after import history moved into its tab; a qa-harness smoke script string after Data Hub's description changed).

Browser: production builds of this worktree on port 3611, identified with `which-openplan.sh` (MATCH), pages reached by clicking the rail at 1440 light, 1100 dark and 390 light and dark. No console errors and no horizontal scroll on any captured page.

## Not done, and why

- **Planner vocabulary (D6).** Packet, retain, campaign, posture and the other terms Nathaniel owns are unchanged; several fell in the jargon ledger only because sentences around them were removed.
- **Engagement index and campaign pages, portal, engagement maps.** Other lanes were active on them throughout.
- **Transit import panel on Data Hub.** GTFS lane.
- **Corridor Analysis in light mode.** It still renders its always-dark `analysis-*` styling; the plan put this last and in its own pull request because light mode broke its tiles before.
- **The command board component** (`components/operations/workspace-command-board.tsx`) is no longer rendered anywhere but six page tests still mock it; remove it with those mocks in a cleanup pass.
- **Reports filters on phones** stack as a tall column of chips.
- **Grants program catalog** still prints one summary per program; a search or filter would shorten the Opportunities tab further.
- **Signal palette and square corners** (M2c additions).
- **Aerial's Atlantic-wide first view** in the test workspace comes from smoke-test missions drawn near 0.02°, 0.02°; the camera frames real records.
- **Keyboard and screen-reader walk**, and observation with practicing planners.
