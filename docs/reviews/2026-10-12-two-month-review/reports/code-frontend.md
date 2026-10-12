## Bottom line

The October passes fixed the frame, the dashboard, the main index pages and the map frame. The dashboard, `GuidedFlow`, `ModalDialog`, `FigureRow`, `PageHeader`, `RecordHubHeader` and `OperatorDetail` are sound and should be the model for the rest.

Four problem groups remain:

1. **Build notes and operator plumbing still reach planners.**
   - Corridor Analysis shows a code roadmap ("Next layer buildout ... CARTO workflow lane") under every result.
   - The RTP index still runs a "queue lane" console.
   - About 20 places put migration numbers or environment variable names in the planner's own sentence, although `OperatorDetail` exists for this and 9 files already use it.
   - The build-notes guard reads every string but only checks seven phrases, and does not read `src/lib`.
2. **Maps.**
   - 13 of 14 map constructors need a Mapbox token. Only the resident map has the key-free MapLibre path.
   - A style-load race the repo measured (2 of 5 loads never drew) was fixed in one hook and is still present at 12 call sites.
   - `mapbox-gl` downloads with every signed-in page to serve one route.
3. **Slow, silent record pages and a "Try again" that doesn't retry.**
   - The project page makes about 45 sequential database reads before it renders.
   - Only 8 of 67 routes have a loading state.
   - 16 of 17 error boundaries only reset the boundary. The portal's own error file says that does not recover a failed server response.
4. **Deferred volume and consistency debt.**
   - The engagement campaign page is twice the size of any other page.
   - Several create forms are still inline, though the doctrine says they must be guided flows.
   - Older record pages print unknown values as zero.
   - There are 2,389 raw colour utilities and no `Select` primitive.
   - About 700 renderable strings contain em dashes.
   - 73 component files are written as single lines up to 4,954 characters long.

## Inventory

| Item | Count |
|---|---|
| Pages | 67: `(app)` 48, `(auth)` 5, `(public)` 6, `(published)` 5, `(portal)` 2, `(embed)` 1 |
| Layouts / loading / error and not-found files | 27 / 8 / 18 |
| API routes | 342 |
| `src/components` | 413 `.tsx` files, 108,256 lines (engagement alone: 91 files, 24,034 lines) |
| `src/app` `.tsx` | 177 files, 49,244 lines (`page.tsx` files: 31,049) |
| `src/lib` | 212,123 lines |
| CSS | 3 files, 8,322 lines (`globals.css` 5,398; `cartographic.css` 2,502; `workspace-gis.css` 422) |
| `"use client"` files | 348 |
| Tests | 1,684 files (402 `.tsx`) |
| Map constructors | 14 |

**Navigation.**
- `components/nav/nav-registry.ts:63-258` is the single source for the rail, the phone sheet, the command palette and the sign-in proxy.
- It has 23 entries in 6 groups and none is hidden from the rail.
- The phone bar shows Dashboard, My Work, Projects and More (`cartographic-rail.tsx:99`).
- `/billing` and `/command-center` are redirect stubs.

**Routes outside navigation.** Every index route is on the rail. Every sub-route has at least one inbound link, but these have only one or two:
- `/grants/bca/<id>`: one list, `grants-bca-screening-section.tsx:43`.
- `/programs/<id>/measure`: one chip, `programs/[programId]/page.tsx:819`.
- `/projects/<id>/management` and `/invoicing/engagements/<id>`: links only inside one-line contract components, `project-contracts.tsx:6` and `contract-management.tsx:41`.

**Navigation gaps.**
- The palette searches modules only, never records.
- Three sibling plan entries remain on the rail (`nav-registry.ts:124-137`).

## Architecture

**Styling: four systems still coexist.**
- 2,389 raw Tailwind colour utilities in 218 files (2,524 on October 1), against 16 uses of the status tokens.
- The `module-*` class family is used 2,941 times.
- 1,479 arbitrary-value utilities.
- 375 uses of the always-dark `analysis-*` classes.
- `--muted` is still a text grey (`globals.css:113`) and `bg-muted` is used as a fill 261 times.

**Primitive use:**
- `Button` 823, `StatusBadge` 616, `Input` 388, `GuidedFlow` 32, `PageHeader` 21, `Card` 16, `ReadFailureNotice` 11, `RecordHubHeader` 9, `FigureRow` 8, `ModalDialog` 4.
- There is no `Select`, `Label`, `Checkbox` or `MapShell` primitive.
- Raw elements outside primitives: 385 `<select>`, 271 `<button>`, 241 `<input>`.

**Duplication:**
- 14 map constructors, each with its own token check, sizing and style handling.
- 11 copy-paste module `error.tsx` files.
- The two project "spine" boards were superseded by `project-spine-board.tsx` and are now imported only by tests.
- 36 files hand-build "Back to X" links.

**Data fetching:**
- 329 inline Supabase `.from()` calls sit in `page.tsx` files.
- The project page makes about 45 sequential awaited reads with one `Promise.all` (lines 139-1032), and loads every tab's data whatever tab is open.
- The client side has 338 `fetch(` calls in 185 files and 166 `router.refresh()` calls.
- There is no shared fetch helper, no SWR or React Query, and only 4 `<Suspense>` boundaries.

## Copy volume

There are about 116,000 static words in total. The signed-in shell adds 2,839 words to every page, 1,389 of them in the Planner Agent drawer.

**Ten wordiest routes** (shell excluded, every tab and branch counted):

| Rank | Route | Words |
|---|---|---|
| 1 | `/engagement/[campaignId]` | 18,264 (90 component files) |
| 2 | `/projects/[projectId]` | 9,407 |
| 3 | `/models/[modelId]` | 6,831 |
| 4 | `/rtp/[rtpCycleId]` | 5,697 |
| 5 | `/grants` | 5,653 |
| 6 | `/data-hub` | 5,194 |
| 7 | `/explore` | 4,326 |
| 8 | `/reports/[reportId]` | 4,036 |
| 9 | `/invoicing` | 3,567 |
| 10 | `/models` | 3,524 |

For comparison, the dashboard is at 851.

**Builder words in strings that reach the screen:**

| Pattern | Count | Examples |
|---|---|---|
| Milestone or ledger ids | 0 | |
| Release numbers | 1 in UI | "v0.39" (`published-structural-diagnosis-card.tsx:44`) |
| "slice" | 2, in lib copy | `lib/models/county-onramp.ts:311,345` |
| "lane" | 145 strings, 45 files | |
| "custody" | 99 | |
| "receipt", system sense | most of 139 | |
| "retain(ed)" | 693 | |
| SHA-256 and hash labels | about 25 | |
| Migration strings | 43 | |
| Environment variable names | 19 | |
| Dotted audit event ids | 5 render sites | `app-copilot.tsx:1434,2336,2420,2465,2735` |
| Em dashes | 695 strings in app and components; 1,751 including lib | |

**Does `planner-pages-carry-no-build-notes` cover all text?** No. It does read every string literal and JSX text in `src/app` and `src/components`. Its gaps:
- It matches only seven phrases (`planner-pages-carry-no-build-notes.test.ts:28-36`).
- It skips `src/lib`, which holds rendered copy such as `lib/http/read-outcome.ts:114`, `lib/rtp/export-input.ts:294,807,812` and `lib/projects/spine-readiness.ts:200,431`.
- It skips generated reports and the resident message catalog.
- The plan's 15-word page-header guard was never built.

## Ranked top 15, by planner impact

1. **A code roadmap and a "lane" console on planner pages.**
   - Corridor Analysis: "Next layer buildout ... CARTO workflow lane", `explore-geospatial-briefing.tsx:83,95,113-118`, mounted at `explore-results-board.tsx:684`.
   - RTP index sidebar: "Primary queue lane", "Dominant share", `rtp-registry-advisory-panel.tsx:131-234`, mounted at `rtp/page.tsx:963`.
   - Project page: "Open control lane", "the creation lane", `project-delivery-board.tsx:189,277,332,414,603`.
   - Models: "v0.39", `published-structural-diagnosis-card.tsx:44`.
   - **Fix:** delete the roadmap card, cut the RTP sidebar to one line, and rename the links to the thing they open. Add these phrases to the guard and extend it to `src/lib`.

2. **Operator plumbing inline in the planner's sentence.**
   - Migration notices: `project-budget-panel.tsx:66-76`, `project-delivery-board.tsx:596-598`, `project-funding-panel.tsx:260,564`, `scenarios/[scenarioSetId]/page.tsx:677,744,1120`, `models/[modelId]/page.tsx:1116`, `explore/page.tsx:159`, `safety/page.tsx:184`, `lib/http/read-outcome.ts:114`, `lib/rtp/export-input.ts:294,807,812`.
   - Environment variable names on six staff maps: `explore-workbench.tsx:730-731`, `aerial-mission-map.tsx:457-458`, `flight-plan-editor.tsx:846`, `mission-aoi-editor.tsx:409`, `participation-heatmap-map.tsx:244`, `rtp-cycle-project-map.tsx:476-477`.
   - Audit event ids in the Planner Agent drawer, including its approval prompt (`app-copilot.tsx:2735`).
   - Safety, the portal and My Work already fold the same kind of text into `OperatorDetail`.
   - **Fix:** shared `SetupPendingNotice` and `MapUnavailableNotice` components, plus a guard that fails on these words outside `OperatorDetail`.

3. **"Try again" does not retry, and the error copy reassures without evidence.**
   - 16 of 17 boundaries only call `reset()` (for example `grants/error.tsx:34`). `(portal)/error.tsx` records why that is not enough.
   - The module pages say "Nothing has been deleted" (`:27-28`), which an error boundary cannot know.
   - 11 of the files are copies.
   - **Fix:** one shared `ModuleError` that refreshes the router and then resets, with the reassurance removed.

4. **Slow record pages with no loading state.**
   - The project page makes about 45 sequential reads and loads every tab (`projects/[projectId]/page.tsx:139-1032`).
   - Only 8 of 67 routes have `loading.tsx`. The engagement campaign, model, scenario, county run, mission and land use plan records have none.
   - **Fix:** run independent reads in `Promise.all`, load only the open tab's data, and add `loading.tsx` to every module.

5. **Maps need a Mapbox key everywhere except the resident map.**
   - 13 of 14 constructors are Mapbox-only, including Safety (`safety-crash-map.tsx:223`) and Corridor Analysis (`use-explore-map-instance.ts:65`).
   - The published land use map hard-codes a Mapbox style (`public-designation-map.tsx:50`).
   - **Fix:** take the key-free engine choice from `public-map-stage.tsx:66-90` and share it, starting with Safety, Corridor Analysis and the geometry picker.

6. **A measured map race left in 12 places.**
   - `map.once("style.load")` after a false `isStyleLoaded()` appears at `cartographic-map-backdrop.tsx:1121` plus nine more in that file, `geometry-picker-map.tsx:455` and `location-display-map.tsx:392`.
   - Updates that bail with no retry: `geometry-picker-map.tsx:425` and `mission-aoi-editor.tsx:300`.
   - The repo's own measurement of this failure (2 of 5 loads) is at `use-workspace-gis-map-binding.ts:320-345`.
   - **Fix:** a shared `whenStyleAccepts()` helper, a guard against `once("style.load"`, and a test fake that can reproduce the race.

7. **The engagement campaign page is twice the size of any other page.**
   - 18,264 words, about 20 panels on 4 tabs. The overhaul skipped it because another lane was working on it.
   - Its synthesis panels carry the heaviest builder dialect: `synthesis-queue-panel.tsx:48,75,78`, `synthesis-progress-panel.tsx:13`, `synthesis-request-history-panel.tsx:85`.
   - **Fix:** apply the overhaul's word rules, and move survey, translation and context-layer setup into guided flows.

8. **Unknown values printed as zero on older record pages.**
   - `rtp-report-detail.tsx:610-632,685-701` prints `?? 0` right beside an honest "Not captured" at `:705`.
   - Also `model-run-equity-panel.tsx:122`, `published-structural-demand-diagnosis-card.tsx:57` and `explore-results-board.tsx:352`.
   - **Fix:** pass null and render through `FigureRow`, and add a guard against `?? 0}` in JSX.

9. **Create flows still inline, which violates the guided-flow archetype.**
   - The doctrine names two of these by name: `allocation-rule-builder.tsx` (798 lines) and the layer-upload wizard `workspace-gis-upload-wizard.tsx` (670).
   - Also `measure-fund-setup.tsx` (552), `client-invoice-composer.tsx` (779), `network-package-upload-form.tsx` (751), `land-use-plan-creator.tsx` and `survey-builder.tsx`.
   - **Fix:** move each onto `GuidedFlow`.

10. **`mapbox-gl` downloads with every signed-in page.**
    - `cartographic-shell.tsx:26,108` statically imports a 2,486-line backdrop that brings `mapbox-gl` with it, but the backdrop only draws on `/aerial` (`map-surfaces.ts`, backdrop line 418).
    - **Fix:** load it with `next/dynamic` behind the route check, or mount it from an Aerial layout.

11. **Accessibility defects in shared frames.**
    - Nested `<main>`: `(public)/layout.tsx:12` wraps `privacy/page.tsx:50`, `terms/page.tsx:54`, `contact/page.tsx:15`, `legal/page.tsx:64` and `(public)/error.tsx:22`, each of which renders its own `<main>`.
    - The Planner Agent approval overlay is `role="dialog"` with no focus handling (`app-copilot.tsx:2722-2726`). This is inferred from code.
    - The traffic volume and crash maps have no keyboard or table path.
    - 18 camera animations ignore reduced-motion settings.
    - There is no automated accessibility (axe) check anywhere.

12. **Wordy headers with no guard.**
    - The plan's 15-word rule was never built into a guard.
    - Over the limit: `workspace/page.tsx:99` (30 words), `engagement/page.tsx:357` (27), `land-use-plans/page.tsx:47` (24), `help/page.tsx:65`.

13. **Four styling systems.**
    - 2,389 raw colour utilities against 16 status-token uses, 385 raw `<select>` with no `Select` primitive, and the `--muted` token collision.
    - About 50 unreferenced global classes, including the whole `shell-*` family at `globals.css:586-694`.
    - **Fix:** a `Select` primitive, a per-file ratchet on raw colours, and deleting the dead classes.

14. **Em dashes in rendered copy, against your rule.**
    - 695 strings in app and components.
    - Examples: the home heading (`(public)/page.tsx:151`), "Free [em dash] all of it" (`:92`), every module error page, the shared failure sentence (`read-failure-notice.tsx:51`) and the unknown-value glyph (`figure-row.tsx:31`).
    - No guard exists for this.

15. **Unreadable files and leftovers the dead-code check can't see.**
    - 73 component files with lines over 400 characters. Worst is `land-use-plan-workbench.tsx` (4,954 characters on one line), then `invoicing/contracts/*` and `programs/work-program/*`.
    - A raw database value renders as text: `engagement_kind.replaceAll("_"," ")` at `project-contracts.tsx:6`.
    - About 1,940 lines are reachable only from tests, because `knip.json` counts tests as entry points:
      - `lib/operations/workflow-next-action-groups.ts` (985 lines)
      - `lib/dashboard/run-figures.ts`
      - two model chart files
      - two project spine boards
      - `receivable-aging-strip.tsx`
      - `ui/separator.tsx`
    - `sonner` and `next-themes` are still in `package.json` with no importer.

**Static 390-pixel risks:**
- `project-spine-board.tsx:74,218` uses `grid-cols-5` with no breakpoint.
- `aerial/page.tsx:351` uses `grid-cols-4`.
- Two tables have no scroll wrapper: `extraction-candidate-card.tsx:511` and `county-run-behavioral-kpis.tsx:108`.
- None of the browser audits runs in CI, and the nightly smokes are desktop only.

## Archetypes

| Archetype | Follows | Violates |
|---|---|---|
| Map-first | `/safety`; `/engage/<token>`, `/embed/<token>`, `/engagement/<id>/preview`; `/aerial` at 1024 px and wider | `/explore`: results card stack with the roadmap and box-in-box nesting (`explore-geospatial-briefing.tsx:82-121`); `/aerial` below 1024 px; `/engage/<token>/about`: older tabbed portal whose map questions are Mapbox-only |
| Guided flow | 21 creators on `GuidedFlow`: projects, plans, programs, reports, RTP cycles and campaigns, scenario sets, models, engagement campaigns, aerial missions and packages, map packages, Data Hub records, invoices, funding opportunities and awards, templates, horizon bands, corridor study brief | Allocation rules, layer uploads, measure fund setup, client invoices, clients, contracts and time entries, network package upload, land use plan creator, survey builder, engagement item and category composers, measure claims and recipients, `CorridorUpload`, RTP extraction launcher, BCA workbench |
| Reading surface | `/rtp/<id>/document`; `(published)` plan, plan document, published plan, land use review; `/help`; privacy, terms, legal, contact | `/reports/<id>` (a control stack; RTP report detail nests four frames at `rtp-report-detail.tsx:600-632`); `/measure/<token>`; `/rtp/<id>/extraction/chapters` |
| Worklist | `/dashboard` (the reference), `/my-work`, `/projects`, `/reports`, `/programs`, `/models`, `/data-hub`, `/plans`, `/scenarios`, `/maps`, `/knowledge-base`, `/assistant-activity`, `/county-runs`, `/land-use-plans`, `/invoicing`, `/grants` | `/rtp` (two queue consoles in the sidebar, `rtp/page.tsx:962-1000`); `/engagement` (27-word header, older chips); `/workspace` (setup form plus deployment health on one page); `/data-hub` (1,393-word GTFS panel) |
| Record hub (D2) | Plan, program, model, scenario set, engagement campaign, RTP cycle, report, aerial mission; project page has the same shape with its own header | `/county-runs/<id>`, `/land-use-plans/<id>`, `/invoicing/engagements/<id>`, `/programs/<id>/measure`, `/programs/<id>/work-program`, `/projects/<id>/management`, `/grants/bca/<id>`, `/aerial/missions/<id>/edit`, `/maps/<id>` |

## What to keep

- The dashboard.
- `GuidedFlow`, `ModalDialog` and `ConfirmDialog`.
- `ReadFailureNotice` with `OperatorDetail`.
- `FigureRow`, which never shows an unknown as zero.
- The nav registry.
- Closed tabs under `Activity`, and the `open-tab-only` test helper.
- The resident map stage: key-free engine choice, its own style-loaded flag, keyboard drawing.
- Keyboard drawing in `GeometryPickerMap` and `MissionAoiEditor`.
- Source guards that state their blind spots.
- One score ramp with no good or bad bands, and caveats kept beside the figure they qualify.

## Open decisions for Nathaniel

- **D6 vocabulary** (packet, retain, campaign, posture): findings 1, 2 and 7 do not depend on it.
- **D8 footer credit:** the public footer still reads "OpenPlan · Nat Ford Planning" (`(public)/layout.tsx:16`).
- **D4:** merge the three plan entries into one.

## What I could not determine

- Rendered word counts, box nesting and the real 390-pixel layout.
- Whether the approval-overlay focus problem and the draw-preview race show in a browser.
- How much page weight `mapbox-gl` adds to non-map pages.
- How the four other palettes render.

Files are in /home/nathaniel/.local/state/openplan-review-20261011/code-frontend/:
- route-words.mjs, buildnotes.mjs, css-classes.mjs, test-only.mjs (new), plus the reused wordcount.mjs and vocab.mjs
- route-words.out, buildnotes.out, buildnotes-all.out, vocab.out, test-only.out
- tree/ (the snapshot)