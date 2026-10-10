# UI overhaul plan, October 10, 2026

**Branch:** `work/ui-overhaul-20261010`, worktree `~/.local/state/openplan/ui-overhaul-20261010`, started from `origin/main` at `0091e284f` (v0.68.0).
**Asked for by Nathaniel, October 10:** a dashboard that is "much cooler and more useful," and an overhaul of the whole app's UI and UX, with the dashboard, main pages and map pages first. His words while this plan was being written: the app is "overall confusing to use," has "way too many subtitles, subtext, unnecessary stuff," "way too much text throughout," and "weird notes in there that shouldn't even be public facing."
**Authority:** he delegated UI decisions on October 1 (D1 to D9 accepted as recommended in `docs/reviews/2026-10-01-ui-ux-review/UI_UX_REVIEW.md`, section 7). On October 10 he asked for this plan to go to an independent agent review and then proceed without his sign-off. This plan is the scoped implementation decision that `docs/ROADMAP.md` line 151 requires before a product redesign.
**Review:** an independent agent reviewed the first draft the same day and found two blocking problems and thirteen others. Section 10 lists each finding and what changed. This is the revised plan.

## 1. What this builds on

The October 1 review found five root causes and shipped phases 0 to 3 in part (see its `IMPLEMENTATION_LOG.md`). This plan does not repeat that work. What is already done and stays: the plain shell for ordinary pages (D1), the phone bar and More sheet, `PageHeader` on 19 index pages, `RecordHubHeader` on 9 record pages, closed tabs under `Activity`, the 12-pixel type floor, fixed status tokens, the shared chart primitives, and locale-pinned numbers.

What the screenshots taken today on the walkthrough instance (`localhost:3000`, build `0091e284f`, same commit as this branch) still show:

- **The dashboard is three overlapping summaries and no answer.** A four-step setup checklist that stays open after setup is done, a workspace card whose title is the 40-character workspace slug, a static "What is worth your attention today" card, four quick links that repeat the rail, a command board of 9 tiles that each carry a sentence, a "primary next action," then "workflow next-action groups" that repeat the same next actions a third time. The charts are on a hidden "Insights" tab. The first screen at 1440 by 900 holds 2,199 words and no chart, no date and no deadline.
- **Developer notes are on planner pages.** Regional Plan (RTP) ends with "Next slice: What comes next," a roadmap for the code. RTP shows "queue trace freshness," "packet scan cue" and "operator status." Travel modeling shows release-numbered study evidence with SHA-256 file hashes in full under the planner's step list.
- **Pages talk too much.** Every section carries an uppercase kicker, a heading and a paragraph. Every number carries a sentence. Grants has 7 stat tiles, then 15 count chips ("0 Appears thin," "1 Without visible modeling support"), then two "Where to start" cards. RTP has 6 stat tiles, then 14 more, then a 5-step "packet queue command board."
- **Map pages float things over the map.** On Safety the workspace card and the account card float over the map, and the account card covers the severity legend. On Aerial the shared map opened on the whole Atlantic for a workspace set to Franklin County, Ohio (cause not yet reproduced; see section 5). Corridor Analysis has a 420-pixel rail of nested setup boxes with the Run button and legend below the fold, and still carries the command board.
- **Labels shout.** About 620 inline `uppercase` class uses, 29 uppercase rules in `globals.css` and 11 in `cartographic.css`.

## 2. Design direction

The palette set and default stay: the roadmap (M2c) says to preserve Cartographic, Slate, Harbor, Meadow, Plum and the Cartographic default. The change is in how much is on screen, how type carries hierarchy, and how pages are laid out.

**Principle: one answer per screen.** A planner opens a page to answer one question ("what do I owe this week," "where are the crashes," "which grants close soon"). The page answers it first, in the fewest words, and puts everything else one click away.

**Type.**
- Body and interface text move to **Public Sans** (SIL OFL 1.1, the USWDS face, built for government text), loaded locally with provenance like the current fonts. Space Grotesk stays for page titles and large figures. This is D7 as accepted. `font-preload-source.test.ts` changes with it, and the console is rechecked for preload warnings.
- Labels are sentence case, no letter-spacing, weight 600, secondary ink. The global eyebrow and kicker classes change once in CSS, and the inline `uppercase` and `tracking-[…]` uses on labels are removed in the files this lane touches. Uppercase survives only for acronyms.
- Large figures use Space Grotesk with tabular numerals.
- A type scale defined as tokens: 12, 14, 16, 20, 28 pixels, plus a 40-pixel display step for dashboard figures.

**Theme.** The default follows the device setting (D3 as accepted). This needs a stored "system" choice, a `matchMedia` check in the pre-paint script, the server no longer hard-coding `dark` on `<html>`, and every map that picks its basemap from the theme reading the resolved mode. A stored "light" or "dark" choice is kept. `CORE_REQUIREMENTS_LEDGER.md` CORE-APPEARANCE-01 ("existing defaults/preferences retained") is updated to cite D3 as the later decision.

**Surfaces.** Fewer boxes, more rules and white space. A section is a heading and its content separated from the next by space and a hairline, not a bordered card. Cards stay where the reader is choosing among siblings (the standard's five tests).

**The one bold element** is the dashboard's "Coming up" date rail (section 3). Everything else stays quiet.

**Announcement.** Public Sans and sentence-case labels change every screenshot. Before the Foundations pull request merges, `COORDINATION.md` gets a note so lanes collecting browser evidence can finish or rebase first.

## 3. The dashboard

Archetype: worklist. Roadmap M2c says to extend Dashboard and My Work rather than build a second dashboard, keep Nathaniel's chosen assigned-work, blocked-project and deadline-digest behavior and user-selectable saved views, and that "unresolved and unreadable sources cannot appear as an empty queue." His August 13 answer on charts stands: 4 to 5 prebuilt charts, each person picks, sensible default, never blank.

```
Dashboard                         [Whole workspace | Assigned to me]
┌──────────────── Needs you ───────────────┐ ┌──────── Coming up ─────────┐
│ 1 project held at a stage gate  Project A│ │ 2 overdue                  │
│ Review 5 public comments       Campaign B│ │ OCT          ● today       │
│ Refresh 1 report               Report C  │ │ 14  Grant closes: ATP 8    │
│ 4 more in My Work                        │ │ 21  Comment period ends    │
└──────────────────────────────────────────┘ │ NOV                        │
                                             │ 3   Invoice window closes  │
Projects                                     │ 12 more in My Work         │
 Name             Stage        Next date     └────────────────────────────┘
 Corridor A       Design       Oct 21, PS&E due
──────────────────────────────────────────────────────────────────────────
Awarded $375,000, 42% drawn*   Comments to review 5   Corridor runs this year 11
──────────────────────────────────────────────────────────────────────────
Charts you chose                                             Choose charts
[Award drawdown]          [Comments per week]
[Deadlines by month]      [Corridor runs per month]
──────────────────────────────────────────────────────────────────────────
Recent changes (5 rows)                                      Build v0.68.0
```

**Data.**
- One shared My Work read feeds both lists. Undated groups (blocked projects, needs review, undated) go to **Needs you**. Dated groups (deadlines, workspace deadlines) go to **Coming up**. An item appears in one list only. The workspace summary's command queue adds its items to Needs you only where My Work has no item for the same record.
- **Coming up reads the window, not the backlog.** My Work reads each source oldest-first with a 20-row cap, so a backlog of overdue items can push every upcoming one out. `loadMyWork` gains two optional bounds (`dueBefore`, `dueOnOrAfter`) applied to dated sources only. The dashboard makes one call for overdue and undated work (`dueBefore` today, cap 20) and one for upcoming dated work (`dueOnOrAfter` today, next 60 days, cap 10, dated sources only). Whenever a source returns its cap, the list says so in words ("Showing 10 of at least 10 deliverables. All in My Work").
- Sources added for Coming up: RTP public review close and adoption target (`rtp_cycles.public_review_close_at`, `adoption_target_date`) and engagement comment periods (`engagement_campaigns.participation_ends_at`). Land use review closings already reach it through My Work's `land_use_plan_review_closing` source.
- **Whose work.** A scope switch at the top: "Whole workspace" (default, since most small agencies have one to three planners) and "Assigned to me." The four workspace-wide sources have no assignee and always show, labeled as workspace items. The scope is in the URL so a supervisor can share the view.
- **Dates by calendar day.** `isDeadlinePast` reads a date-only value as midnight UTC, so a deadline of the 14th turns overdue at 5 pm Pacific on the 13th. For date-only values it changes to "past when no time zone is still on that date," which is never early, and My Work inherits the fix. The "today" mark and overdue labels on the dashboard use the browser's own calendar date.
- Load: the two My Work calls add about 30 parallel reads. Server time for `/dashboard` is measured before and after on the same workspace and recorded in the implementation log.

**Layout and content.**
- **Needs you.** Up to six one-line items, each naming the record and linking to it, then "N more in My Work" when there are more. A failed source shows "Could not check grants" as a line in the list, never an empty list.
- **Coming up.** A vertical rail with month breaks, a "today" mark, an icon and a word for each kind, and the record name as the link. Overdue items sit above today with "overdue" in words and the urgent status colour. "N more in My Work" at the foot.
- **Projects.** Active projects with stage and next dated item, the next date column first. This replaces the four-figure strip's "Active projects."
- **Figures.** Three, each a label, a value and a link. A failed read shows a dash and "not available." Award drawdown keeps its disclosure as the qualifier whenever it is nonzero: awards with no recorded amount are left out, and invoices with no award link are counted (`chart-series.ts:179-186`). "Corridor runs" names what is counted; failed model runs are a My Work item.
- **Charts on the main view.** The Overview and Insights switch goes away. The chart picker's stored choice is the saved view M2c asks for, and the scope switch is the second. Catalog: award drawdown, comments per week, deadlines by month (new, counts by kind for the next six months), corridor runs per month, composite scores (withheld scores stay withheld). "Open work" is retired because Needs you replaces it. A stored choice that names a retired chart maps to its replacement, and a stored choice that parses to nothing known falls back to the default, so no stored value can blank the dashboard. Default: the first four.
- **Setup.** The checklist shows in full only while a required step is open. Once required steps are done it becomes one line ("Setup: 3 of 4 done. Invite your team") that can be dismissed.
- **Recent changes.** Five rows at the foot, linking to Planner Agent Activity for the full record.
- **Build line.** Stays at the foot. `a-deployment-can-name-itself.test.ts` requires it, so a healthy instance still names its version.
- **Removed from the dashboard:** the workspace intro card, the operator guidance card, quick actions, the command board and workflow groups, and Run history (it already lives in Corridor Analysis).
- **Phone:** Needs you, Coming up, Projects, figures, then charts one per row.

## 4. Shell and navigation

- **Rail.** Group titles in sentence case. "Overview" becomes "Dashboard," which is Nathaniel's word for it; "overview" and "command center" stay as search keywords. Scenarios and Model Validation appear under Travel modeling (D4's other accepted item). Planner Agent Activity stays on the rail (decision of August 10, `804bfd06b`). Workspace setup stays on the rail.
- **Header.** Workspace switcher, search, appearance, Planner Agent. No clock.
- D4's single "Plans" entry is a larger change to three modules and is not in this pass.

## 5. Map pages

Corridor Analysis and Safety each build their own map. The Aerial index draws the shared shell map, which carries the workspace layer library, mission areas and "Read the map." That split is deliberate (`safety-owns-the-only-map`, `map-controls-only-on-map-surfaces`) and stays.

**The frame (all three):** the 60-pixel collapsed rail and the plain header, the map running to the window edge with no border, and one docked panel. Safety's measured layout is the reference: map from the rail to the panel, panel on the right, rail collapsed at rest (`safety-map-runs-to-the-edge.test.ts`, 64.9 percent of the window is map). Corridor Analysis already docks its panel on the right and moves onto the same frame. Aerial keeps its panel on the left, because the shared map's layer and legend dock sits on the right; it gains the collapsed rail. Nothing floats over a map except the legend, zoom, basemap picker and attribution. The workspace card and account card stop floating over the map on these routes: the workspace switcher sits in the header and the account control moves into the rail foot.

**The panel (Safety and Corridor Analysis):** a shared `MapPanel` with a title, tabs and a pinned footer for the primary action (Run, Retrieve crash data), so setup, layers and results stop sharing one scroll.
- Safety tabs: Crashes (study area, filters, KSI list, selected collision), Layers, Report and export. Filters move from the bottom of the scroll to the top of Crashes.
- Corridor Analysis tabs: Study area, Layers, Results, History. The command board leaves this page, which completes the October 1 rule of one command board.
- **Caveats stay at the figure.** Server HTML omits closed tabs, so a protected caveat cannot move into a tab other than the default. The claim tier and the "may not conclude" half stay visible beside the number they qualify. Safety's geocoding shortfall ("did not geolocate") stays in the default tab.

**Camera.** Safety and Corridor Analysis start on the continental view today (`safety-crash-map.tsx:226`, `use-explore-map-instance.ts:44`). They start on the workspace home bounding box when one is set, read from the bbox columns only (`home_min_lon` and its neighbours, through `deriveHomeMapView` in `home-geography.ts:273`, never `home_geometry_geojson`). The shared map already frames workspace features, then home, then the continent; the Atlantic-wide view on Aerial is reproduced first and fixed only once its cause is known.

**Legends and attribution.** Legends get a "No data" row wherever the paint has a no-data colour. The backdrop's zero-vehicle ramp uses the shared tract classes so the measure has one ramp. A guard checks that each file constructing a map adds `AttributionControl`.

**Phone.** The map takes the top half of the window and the panel scrolls beneath it. On Aerial, "Read the map" stays where it is in the panel.

**Order inside this step:** Safety and Aerial frame first; Corridor Analysis frame and panel second; Corridor Analysis following the light theme last and in its own pull request, because 135 `analysis-*` classes are involved and light mode broke its tiles before.

**Not changed:** the traffic-volume and model-agreement maps on model pages, the RTP project map, the Aerial mission maps, and every engagement map (another lane is working on those today, and owns `test/helpers/mapbox-gl-fake.ts`).

## 6. Words

This pass deletes and shortens. It does not rename planner vocabulary: D6 waits on Nathaniel (`IMPLEMENTATION_LOG.md:291`), so a string like "packet scan cue" may lose its card but keeps its D6 word.

Rules for every page this lane touches:

1. Page header: the title and at most one sentence of 15 words or fewer, or nothing.
2. Section: a heading. No kicker above it. A sentence under it only when it changes what the planner does.
3. Figures: a label and a value, with a qualifier of six words or fewer when needed. At most four in a row. Chip walls of counts are removed; the counts stay reachable through filters or the page they describe.
4. Empty state: one sentence and one button.
5. No developer notes in planner copy: roadmaps, "slice," "lane," "queue trace," release numbers, file hashes, registry versions.
6. **Protected caveats keep their one definition site, their meaning and their visibility at the figure.** Moving a caveat into a disclosure is allowed only when the claim tier and the "may not conclude" half remain visible in the summary line.
7. **Travel modeling evidence stays on the same page**, in a closed disclosure per study. Each summary line keeps the scientific outcome badge (for example "Inconclusive") and the sentence "No model accuracy conclusion follows." The cards are not shortened inside the disclosure; the v0.44 reassessment already found they omit facts.

Pages, in order: dashboard; Regional Plan (RTP); Travel modeling; Grants; Projects; Reports; Data Hub (only after the GTFS lane records the files it owns in `COORDINATION.md`, and never the transit import panel); Engagement index; Plans; Programming Cycles; Land Use Plans; Invoices; My Work. Record pages (project, plan, report, model) get kicker and build-note removal and the local-support panel as a header chip (D5), and otherwise keep their layout.

## 7. Guards

Each new or changed guard gets a harmless edit that passes and a targeted break that fails for the stated reason, per `AGENTS.md`.

- **Developer notes stay out of planner copy.** Extend `interface-copy-does-not-leak-internal-vocabulary.test.ts` with the build-note phrases removed in this pass, and add a string-literal scan for the files this lane touches, because its JSX text pattern skips text beside an expression (`v{study.version} · development evidence` passes it today). Blind category: notes in files outside this lane's list, and notes phrased in words not on the list.
- **Uppercase labels.** A per-file equality count of `uppercase` for the files this lane changes, plus the uppercase rules in `globals.css` and `cartographic.css`. Per-file, so other lanes adding a class elsewhere do not fail CI. Blind category: files this lane did not touch, and uppercase typed into the string.
- **Short page headers.** `PageHeader` descriptions are one sentence of 15 words or fewer. Blind category: pages that do not use `PageHeader`.
- **Dashboard behavior.** Coming up sorts by date, shows overdue in words, says when a source hit its cap, and shows a failed source as unavailable; Needs you never renders a failed read as empty; an item appears in one list only; a stored chart choice can never parse to a blank dashboard; figures refuse a failed read; date-only deadlines are never overdue early.
- **Map attribution.** Every file that constructs `mapboxgl.Map` adds `AttributionControl`. Blind category: maps built by another library.
- **Caveats at the figure.** For each protected claim this lane moves, a test renders the default view and finds both halves in it.
- **Existing guards that change**, each updated in the same commit with the reason: `nav-registry.test.ts` (labels, Scenarios and Model Validation visible), `dashboard-layout-contract.test.ts`, `dashboard-page.test.tsx`, `dashboard-chart-view.test.tsx`, `font-preload-source.test.ts`, `safety-map-runs-to-the-edge.test.ts` (new measured numbers), `theme-*` tests, the card-nesting budget and the jargon ledger counts. `qa-harness/governed-decision-handoff-smoke.js` clicks the link named "Projects" without `.first()`; links on the dashboard avoid that exact name or the script is fixed.

## 8. Order of work and landing

Each step is its own pull request, rebased on `origin/main`, merged after GitHub CI passes. Shared stylesheet edits go in clearly marked blocks so merges with other lanes stay mechanical. Ownership is in `~/.local/state/openplan/COORDINATION.md`.

1. **Foundations:** Public Sans, type tokens, sentence-case labels, status badge at 12 pixels in sentence case, theme follows the device, rail label and group changes, uppercase and page-header guards. Announced in `COORDINATION.md` before merge.
2. **Dashboard:** section 3, the `loadMyWork` bounds, the deadline fix, and their guards.
3. **Map frame:** Safety and Aerial, then Corridor Analysis frame and panel, then (separately) Corridor Analysis in light mode.
4. **Words:** section 6, main pages, then record pages.
5. **Verification and record:** card-nesting and map-reading audits refreshed, an implementation log beside this plan, `KNOWN_ISSUES.md` updated, memory updated.

**Checks for every step:** lint; typecheck through the production build; the targeted test files on one or two workers; the full suite on two workers with a memory watchdog before each merge; a production build of this worktree on a free port, identified with `which-openplan.sh`, walked from real navigation at 1440 and 390 pixels with the console reviewed and screenshots kept; the browser audits where budgets change. The disk had 12 GB free on October 10, so build output is cleaned between steps.

## 9. Not in this pass

- Renaming planner vocabulary (D6). Questions go to Nathaniel at the end.
- Merging RTP, Land Use Plans and Plans into one module (D4's full form).
- The engagement portal and engagement maps (another lane today), the transit import panel (GTFS lane).
- The Signal palette and square-corner option (M2c additions). They are small and authorized; they follow this pass if time allows.
- A MapLibre or free-tile fallback for installs without a Mapbox token.
- The public home page and sign-in, except fixes that fall out of the type change.
- A workspace time zone setting. The deadline fix is conservative without one.
- Observation with practicing planners, which no agent journey replaces.

## 10. Independent review and what changed

| # | Finding | Change |
|---|---|---|
| 1 | Map frame ignored that Aerial uses the shared map and reversed Safety's measured full-bleed layout | Section 5 rewritten: per-route map ownership kept, collapsed rail and edge-to-edge map on all three, Safety's right-docked panel as the reference |
| 2 | Coming up could silently drop upcoming items behind an overdue backlog; scope unstated; date-only deadlines turn overdue the evening before; six-item cap hid the rest | Window-bounded second read, cap disclosed in words, scope switch, calendar-day deadline fix, "N more" counts |
| 3 | Home bbox already exists; Aerial's Atlantic view is probably feature framing | Camera fix limited to Safety and Corridor Analysis; Aerial reproduced first |
| 4 | Caveats could be hidden in closed tabs; modeling evidence and drawdown disclosure at risk | Caveat placement rule, modeling evidence in same-page disclosures with outcome badge, drawdown qualifier kept |
| 5 | Missed guards: build line, Planner Agent Activity on rail, font preload | Build line kept, Activity stays on rail, font test changes with console recheck |
| 6 | Developer-notes guard skips text beside expressions | String-literal scan added for touched files |
| 7 | Repo-wide uppercase count would fail other lanes | Per-file count for touched files |
| 8 | Attribution guard as first written would prove nothing | Checks `AttributionControl` per file; mapbox fake left to its owner |
| 9 | Dropping "open work" and changing the default could blank a dashboard | Retired id mapped; unknown choice falls back to the default |
| 10 | Overview/Insights switch may be M2c's saved view | Chart choice and scope switch named as the saved views |
| 11 | Needs you and Coming up overlapped; comment periods missing | Split by My Work group; comment periods and RTP dates added |
| 12 | Page load roughly doubles | Bounded reads, measured before and after |
| 13 | Theme following the device is a larger change | Specified in section 2; requirements ledger updated |
| 14 | Command board would survive only on Corridor Analysis | Removed there in the map step |
| 15 | Words pass limits unstated | Section 6 states it deletes and shortens only |
| Sequencing | Split Corridor Analysis light mode; announce Foundations; GTFS ownership first; trade the cosmetic rail regroup for D4's Scenarios and Model Validation | All four adopted |
| Minor | Smoke script link name; "model runs" ambiguity; phone "Read the map"; rename cost; uppercase count; audit feed low value | All addressed in sections 3 to 7 |
