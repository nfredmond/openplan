# OpenPlan UI/UX review

**Date:** October 1, 2026
**Build reviewed:** v0.66.0. Code read at `891a0d89`. Browser pass on the walkthrough instance at `bc47c0ce`, which is one documentation-only commit behind (`git diff bc47c0ce 891a0d89 -- openplan/src` is empty).
**Status:** findings and a proposed work plan. Nothing in the application was changed. `docs/ROADMAP.md` line 80 requires a scoped decision before product redesign starts; section 7 lists the decisions this report needs from Nathaniel.

## 1. Bottom line

OpenPlan's interface problem is not the visual style. The dark cartographic look, the palette system and the honesty of the copy are assets. The problem is volume and repetition: every screen shows too many words, too many boxes and too many small uppercase labels, and almost none of it comes from shared parts.

Five causes produce most of what a planner sees:

1. **The page frame wastes the screen.** Every signed-in page sits in a floating panel over a wallpaper map. On a 390 by 844 phone the content window is 358 by 568 pixels, 62 percent of the screen, and the project page scrolls 33,649 pixels inside it (59 windows).
2. **Record pages have no layout pattern.** The four archetypes adopted on August 13 do not cover the pages where planners spend their time: one project, one plan, one program, one model, one report. Those nine pages hold the most boxes and words in the product. One report page renders 21,168 words and 1,275 bordered boxes.
3. **There is no single design system.** Four styling systems run side by side: design tokens, 517 hand-written global classes, 2,524 raw Tailwind colour utilities and an always-dark `analysis-*` family. Type, radius, shadow, layering and motion have no scale. The type alone uses 31 arbitrary sizes.
4. **The copy pass did not hold.** Newer modules speak a second builder dialect ("retain," "exact request," "identity," "unassessed"). The guard reads only 41 percent of rendered words.
5. **Accessibility fails in a few shared parts.** No skip link, no main landmark in the app shell, two button variants that fail contrast in the default dark theme, 9.9-pixel status badges at 623 call sites, and input borders at 1.3:1 against a 3:1 floor.

All five are fixable in shared code. The recommended order is: fix what is broken, build the foundations once, then move pages onto them by archetype. Section 6 gives the plan.

## 2. Method and limits

**Rendered pass.** Chrome through Playwright, signed in as the local test account, at 1440 by 1000 and 390 by 844. I captured 34 signed-in routes (24 index routes and 10 record pages), 10 public and auth routes, and the resident portal with a real active link. I also captured light mode, 3,000-pixel-tall views of 32 pages, the Planner Agent drawer and the command palette. For each page a script counted words, bordered boxes, nesting depth, uppercase labels, text under 12 pixels and control sizes. The script and its output are in `evidence/capture.js` and `evidence/rendered-metrics.json`.

**Code pass.** Seven read-only audits covered the stylesheets and tokens, navigation and layout, accessibility, copy, public and first-run surfaces, maps and charts, and the existing record of UX decisions. Counts from those audits are source counts by regular expression, not rendered counts. Each finding below says which kind it is.

**What this review did not do.**

- No keyboard-only or screen-reader walk. Accessibility findings are from code and computed contrast.
- No practicing planner or resident was observed. `docs/product/PLANNER_OBSERVATION_PROTOCOL.md` still records zero participants.
- The other four palettes (Slate, Harbor, Meadow, Plum) were not rendered. Contrast for them is calculated from tokens.
- The workspace holds test data. Counts of boxes and words will differ in a real agency workspace.
- I did not run `qa-harness/openplan-local-card-nesting-audit.js`. Its budget file dates from August 13 and is probably stale.
- Print output, right-to-left layout and 400 percent zoom were not tested.

**A record problem to know about.** The UX feedback log at `~/.claude/plans/nathaniel-ux-feedback-log.md` no longer exists on disk or in git history. Its settled decisions survive in `openplan/docs/PLAIN_WORDS_FEWER_BOXES.md`. Anything added to the log after August 14 is lost. If you remember items from it, section 7 is the place to restate them.

## 3. What works and should be kept

- **The palette mechanism.** Five palettes, light and dark, set before first paint, guarded by tests. The planned Signal palette and square-corner option (roadmap M2c) fit this mechanism.
- **The dialogs.** `ModalDialog`, `ConfirmDialog` and `GuidedFlow` use the native dialog element with correct focus handling. The code has zero `window.confirm` calls.
- **The resident portal's structure.** It opens on the map. On a phone the map holds 83 percent of the screen (`evidence/15-portal-390.png`). Drawing works from the keyboard.
- **Safety.** It is the one in-app page that is map-first (`evidence/10-safety-1440x3000.png`).
- **The RTP document page and public plan document.** A 36rem column at 17 pixels with 1.65 line height. This is the model for every reading surface.
- **Honesty copy.** "Could not be read" stays distinct from "none." Unmeasured stays distinct from zero in text. The plan below changes how this is presented, never what it says.
- **The home page text.** It is concrete and plain. It needs pictures and a brand, not a rewrite.
- **The guards.** About 40 tests protect layout, copy and navigation decisions. The plan extends them.

## 4. Root findings

### R1. The shell spends the screen on decoration

Evidence: `evidence/01-dashboard-dark-1440.png`, `evidence/02-dashboard-390.png`, `evidence/04-project-detail-390.png`.

- Every signed-in page renders inside `.op-cart-surface`, a bordered panel floating over a full-window map (`openplan/src/app/cartographic.css:387`). On all pages except Safety and Aerial the map is wallpaper. It sits under a panel at 92 to 94 percent opacity with an 18-pixel blur.
- The page scrolls inside the panel, not the window. The workspace switcher overlaps the panel's top-left corner. A clock sits under the workspace name.
- At 390 pixels wide the content window measures 358 by 568. The header controls take the first 160 pixels. The navigation is a bar of 20 unlabeled icons that scrolls sideways, each 48 by 23 pixels, which is under the 24-pixel minimum in WCAG 2.5.8.
- Inside that window, cards nest three deep, so body text runs in columns 152 to 282 pixels wide. On Corridor Analysis the median paragraph is 163 pixels wide and the narrowest is 77.
- The app shell has no `<main>` landmark and no skip link, so a keyboard user tabs through the map and the whole rail on every page.

Fix: give ordinary pages a plain full-width page that scrolls with the window. Keep the full-bleed map for map surfaces only. This is decision D1.

### R2. Record pages have no archetype, and they are the heaviest pages

Evidence: `evidence/03-project-detail-1440x3000.png`, `evidence/07-report-detail-1440x3000.png`, `evidence/09-model-detail-light-1440x2600.png`.

| Page (rendered, test workspace) | Words | Bordered boxes | Uppercase labels |
|---|---|---|---|
| One report | 21,168 | 1,275 | 64 |
| Grants | 9,216 | 72 | 276 |
| One model | 7,139 | 204 | 181 |
| One project | 4,988 | 91 | 222 |
| One engagement campaign | 2,798 | 67 | 58 |
| One plan | 2,596 | 58 | 104 |
| One program | 2,384 | 66 | 170 |
| Dashboard | 2,221 | 40 | 113 |

- Hidden tab panels stay mounted (`page-tab-panel.tsx:24`), which is why the counts are this high. The planner does not see all of it at once, but the browser loads and the screen reader reads all of it.
- 14 record routes fit none of the four archetypes. Seven of the eight largest page files are record pages, each 1,320 to 1,486 lines.
- Three record pages use URL tabs (project, RTP cycle, campaign). Four are one long scroll with no tabs (plan, program, scenario set, model).
- The first block on a project page is not about the project. It is "Local support: Can OpenPlan do this here?" with a registry version and a SHA-256 hash, above the project's own tabs.
- Stat tiles stack one per row at 1440 pixels on the project, grants and RTP pages. Seven full-width tiles each hold a single digit (`evidence/05-grants-1440x3000.png`, `evidence/06-rtp-1440x3000.png`).
- The grants program catalog lays out its definition list in columns about 50 pixels wide, so text wraps one word per line.
- `WorkspaceCommandBoard` repeats workspace-wide "what needs attention next" content on 10 pages, including record pages.

Fix: adopt a fifth archetype, the record hub (decision D2), and move the nine record pages onto it.

### R3. Four styling systems and no scales

Source counts, `openplan/src`, tests excluded.

- **Type.** 31 arbitrary font sizes in 866 uses. 619 uses are under 12 pixels and the smallest is 9.3 pixels. Rendered, 3,452 of 12,225 text elements across 32 routes are under 12 pixels (28 percent). On Documents and Planner Agent Activity the share is 74 to 75 percent.
- **Uppercase labels.** 614 uses in components and about 20 near-identical class definitions with 11 different letter-spacings. Rendered, 2,843 uppercase labels across 32 routes. When every card, tile and chip carries one, they stop marking anything.
- **Cards.** Eight bordered-panel class families that differ only in radius and padding. The `Card` primitive has 16 uses. `module-section-surface` has 215 and `module-summary-card` has 155.
- **Controls.** 358 raw `<select>` elements in 122 files with no Select primitive. 210 raw buttons and 207 raw inputs bypass the primitives.
- **Colour.** 2,524 raw Tailwind colour utilities carry status (amber, emerald, red). 1,633 have no dark-mode pair. The status badge maps success and warning to palette accents, so under the Plum palette success is violet.
- **Token collision.** `--muted` is a text grey, and both `bg-muted` (200 uses) and `text-muted-foreground` (2,584 uses) resolve to it. `hover:bg-accent` paints full copper.
- **Always-dark slabs.** 135 `analysis-*` classes, `.module-operator-card` and `.public-rail` hardcode dark colours and ignore mode and palette. In light mode Corridor Analysis is a dark slab in a light page, and a white card inside it shows grey tiles whose numbers cannot be read (`evidence/08-explore-light-1440x2600.png`).
- **No tokens** for radius (24 values), shadow (27 CSS values, 31 Tailwind values), z-index (11 values) or motion (7 durations). Reduced motion covers three selectors.
- **Dead code.** 49 of 517 global classes have no reference, including the whole `shell-*` family. One referenced class, `public-fine-print`, has no definition because the guard checks only three prefixes.
- **Typeface.** Body and headings are both Space Grotesk. It is a display face. Its letterforms slow reading in the long caveat paragraphs this product depends on.

### R4. The copy still talks like its builders

Source counts across 12,329 rendered strings, about 80,000 words.

- **Second dialect.** "Retain" appears 227 times, including 18 button labels ("Retain delivery event"). "Request" as an object appears 222 times, "exact" 100, "worker" 79, "recovery" 70, "preserve" 58, "unassessed" 26. None is in the jargon ledger.
- **First dialect, still present.** "Packet" 305, "posture" 75, "lane" 63, "artifact" 91, "queue" 109.
- **Build notes shown to planners.** About 45 strings. Examples: "First version deliberately favors traceability over automation theater" (`data-hub/page.tsx:679`), "Why this slice matters" (`:1117`), "Next slice" (`rtp-queue-operations-board.tsx:79`), "Lane C migration" in six strings.
- **Length.** 112 strings run 40 words or more. One sits beside a single checkbox at 84 words (`county-runs-page-client.tsx:278`).
- **Verbs.** Seven verbs start a new thing (New, Add, Create, Start, Log, Record, Retain). Seven save it. Five reload a list.
- **Names.** The rail says "Travel modeling" and the page says "Models." The rail says "Documents" and the path says knowledge base. "Engagement" means public engagement everywhere except Invoicing, where it means a client contract.
- **Status words.** About 1,150 distinct labels. Thirteen ways to say "not known" and seven ways to say "finished."
- **Raw errors.** 286 call sites render API error text directly. The routes hold 279 "Unauthorized" and 463 "Invalid..." strings. Environment variable names reach planner copy in three map components.
- **Em dashes.** 2,994 occurrences in 349 component files, comments included. They show on nearly every rendered screen, including the home page headline.
- **The guard's blind spot.** It reads JSX text nodes only. Props, placeholders, ternaries and template literals hold 59 percent of rendered words. In the translation panels the share is 71 percent.

### R5. Accessibility fails in shared parts

Code read and computed contrast. Dark is the default theme.

| Finding | Evidence | WCAG |
|---|---|---|
| No skip link; no `<main>` in app shell or portal | zero hits in source | 2.4.1, 1.3.1 |
| Secondary button text `#1f2428` on `#1a2226` in dark, about 1.05:1; 9 sites. This is KI-2026-09-05-062 | `ui/button.tsx:15` | 1.4.3 |
| Destructive button white on `#ff7166` in dark, 2.69:1 | `ui/button.tsx:13` | 1.4.3 |
| Primary button and accent links in light Cartographic, 3.28 to 3.70:1 | `globals.css` tokens | 1.4.3 |
| Status badge at 9.9 pixels; info and warning tones 2.86 to 3.27:1 in light; 623 sites | `ui/status-badge.tsx:23` | 1.4.3 |
| Input and select borders 1.25 to 1.67:1 | `--input` token | 1.4.11 |
| 73 of 1,095 form controls have no label; 50 are in one file | `land-use-plan-workbench.tsx` | 3.3.2, 4.1.2 |
| 65 of 127 files that set an error never announce it | no `role="alert"` | 4.1.3 |
| Planner Agent drawer and command palette have no focus trap or return | `app-copilot.tsx:2163`, `command-palette.tsx:91` | 2.4.3 |
| Crash and traffic-volume details reachable by mouse only, no table | `safety-crash-map.tsx`, `traffic-volume-map.tsx:196` | 2.1.1, 1.1.1 |
| `<html lang="en">` on Arabic, Farsi and Urdu portal pages | `app/layout.tsx:89` | 3.1.1 |
| Reduced motion not honored for 164 spinners and 30 map animations | two media blocks only | 2.2.2 |

## 5. Findings by area

Severity: **High** blocks a task or breaks a legal or licence duty. **Medium** slows or confuses. **Low** is polish.

### 5.1 Navigation and wayfinding

- **N1, High.** Three sibling entries for plans: "Regional Plan (RTP)," "Land Use Plans" and "Plans." Two share an icon. The Plans page copy claims general plans and regional plans. A new planner cannot predict which holds their plan.
- **N2, Medium.** 20 rail entries in six groups. Scenarios and Model Validation are hidden from the rail and reachable only through the palette or deep links.
- **N3, Medium.** Labels, page titles and paths disagree in six places (Travel modeling and Models, Documents and `/knowledge-base`, Corridor Analysis and `/explore`, Model Validation and `/county-runs`, Aerial Imagery and "Aerial Ops," Overview and the workspace name).
- **N4, Medium.** Breadcrumbs exist on one route. Other record pages use "Back to X" links in four different stylings. The command palette finds modules, never records.
- **N5, Medium.** At least nine page-header patterns and no shared component. The dashboard has no title above its first card.
- **N6, Medium.** On eight index pages the header "New" button jumps to a card farther down the page, whose own button opens the wizard.
- **N7, Medium.** A project links out to filtered lists in other modules, not to its own linked records. Report, campaign and RTP record pages have no link back to their project.
- **N8, Medium.** About 14 create forms are still inline and always on screen, including the land use plan creator, the client invoice composer (17 inputs) and measure fund setup (14 inputs). Sixteen flows use the wizard.
- **N9, Medium.** 7 of 45 app routes have a loading state. Nine near-identical error files exist and nine modules have none. 19 files still join database error text into the planner's sentence.

### 5.2 Maps and charts

- **M1, High.** 14 separate map constructors and no shared map component. Six layer pickers, seven legends and eight popup implementations.
- **M2, High.** Seven maps turn attribution off and add none back, including the map on public forms. Mapbox and OpenStreetMap require it. Code read; confirm on screen before fixing.
- **M3, High.** Corridor Analysis is map-first in name only. The map sits inside a bordered shell inside the page panel, and the 420-pixel rail holds setup, project context, two layer panels, results and history in one scroll.
- **M4, High.** Aerial is cards and a table. Mission maps are boxed at 380 to 420 pixels tall.
- **M5, High.** The corridor score paints red to green with unvalidated cut points, and a second different ramp paints the same score on the corridor fill. `docs/product/CORRIDOR_SCORE_PRESENTATION_RESEARCH_2026-08-24.md` decided against good and bad bands.
- **M6, High.** Missing data paints as the lowest class on Corridor Analysis. A tract with no income value shows in the under-$45,000 colour. This breaks the rule that unassessed stays distinct from zero.
- **M7, Medium.** Poverty, zero-vehicle and demand ramps mix red and green. The same measure uses different ramps on different maps. Traffic volume scales to each run's maximum, so colours do not compare across runs.
- **M8, Medium.** No legend carries units, a source or a year. Traffic volume has swatches with no numbers.
- **M9, Medium.** Charts exist on the dashboard only. Reports and measures have none. Engagement panels use five separate hand-built bar styles.
- **M10, Medium.** 164 formatting function names, with `formatCurrency` defined 14 times. 232 `toLocaleString()` calls pass no locale, so output depends on the server and browser.
- **M11, Medium.** Honesty content arrives as stacked paragraphs. The model evidence panel is 1,849 lines with 92 paragraphs and no disclosure. The Safety sidebar runs about 5,600 pixels on a phone.

### 5.3 Public, portal and first run

- **P1, High.** A person who confirms their email after choosing "Run your first corridor study" lands on a 404. `app/auth/callback/route.ts:70` assigns `/dashboard?intent=modeling` to `pathname`, which encodes the question mark. Verified in code; not reproduced in a browser because local sign-up skips confirmation.
- **P2, High.** The portal asks for a name "if you want the team to know who sent this," then shows the name publicly on approved comments. No privacy link exists in the portal.
- **P3, Medium (corrected October 1).** The language picker showed 21 options as open chips above the campaign title (`evidence/14-portal-1440.png`). Only Spanish has interface text; the others show English controls with a disclosure, and campaign content can be translated per language. That fallback is a recorded design choice in `portal-language-picker.tsx` and `portal-i18n/messages.ts`, so the first draft of this finding was wrong to call the list itself a defect. The defect is the placement and size. Fixed by collapsing the list into one row.
- **P4, High.** A closed or archived campaign returns the generic 404, so a printed postcard link dies and the results page is unreachable.
- **P5, High.** A failed portal read sends a resident to the app's error page, which says "go back to Overview."
- **P6, High.** No print stylesheet covers the public plan pages, and the default theme is dark.
- **P7, High.** Agency plan, measure and land use pages carry OpenPlan's "Create free workspace" navigation.
- **P8, Medium.** At 390 pixels the sign-in form is below the first screen. The page is 1,588 pixels tall and the first 844 are marketing text (`evidence/13-sign-in-390.png`).
- **P9, Medium.** The home page has no screenshot, map, illustration or logo (`evidence/12-home-1440.png`). It says "Free, all of it" without saying that AI drafting uses the agency's own provider key.
- **P10, Medium.** The favicon is the Next.js default. The social preview image is an SVG. Five scaffold SVGs remain in `public/`. No manifest or theme colour.
- **P11, Medium.** No wordmark. Four different taglines. The footer credits Nat Ford Planning, which is paused. That attribution is your call.
- **P12, Medium.** Sign-up asks an invited person for an organization name and creates a stray workspace. With confirmation off, sign-up sends a signed-in person to sign in again.
- **P13, Medium.** The embed renders the older tabbed portal at a fixed 720-pixel height.
- **P14, Medium.** On desktop the portal has 32 of 39 controls under 44 pixels tall. On a phone, step 1 says "Tap the map" while the open sheet covers up to 75 percent of it. Code read; not exercised.
- **P15, Medium.** Help is one page. Outside the rail, two places in the app link into it.

### 5.4 Known issues this review confirms or explains

- KI-2026-09-05-062 (unreadable Generate PDF button): cause found, R5 row 2.
- KI-2026-09-05-063, -069, -054, -083 (cramped or clipped layouts at 390 pixels): symptoms of R1 and R2.
- KL-2026-09-04-017 (no proof of keyboard, screen-reader, print or language quality): still open. This review narrows it and does not close it.

## 6. Proposed work plan

Each phase leaves the app shippable. Each visible change needs what `AGENTS.md` requires: a journey from real navigation on an identified build, desktop and 390-pixel evidence, a console check, and a mutation proof for any changed guard.

### Phase 0. Fix what is broken

Small, independent fixes. No design decision needed.

1. Button contrast: secondary and destructive variants (closes KI-062).
2. Sign-up callback 404 (P1).
3. Portal name disclosure and privacy link (P2).
4. Map attribution on the seven maps (M2).
5. Missing data painted as zero on Corridor Analysis (M6).
6. Light-mode unreadable tiles on Corridor Analysis (R3).
7. Stat tiles stacking one per row; grants catalog column widths (R2).
8. Sign-in form first on phones (P8).
9. Skip link and `<main>` landmark (R5).
10. Portal error page, loading state and closed-campaign page (P4, P5).
11. Favicon, PNG social image, remove scaffold files (P10).
12. Language picker collapses to one row and keeps every language (P3).

### Phase 1. Foundations

Build once, in shared code. Pages do not change shape yet.

- **Tokens.** One type scale of six steps with a 12-pixel floor. One radius scale, which also delivers the square-corner option in M2c. Three shadows, four layers, two durations. Status tokens (ok, warn, urgent, info) that no palette overrides. An inverse-surface token set to replace the hardcoded dark slabs. Rename the `--muted` and `--accent` seeds so the Tailwind names mean what they say. Raise input borders to 3:1 and darken light-mode accent and warning text.
- **Primitives.** `PageHeader`, `Card` with four variants, `StatTile`, `Select`, `Checkbox`, `Chip`, `Eyebrow`, `Legend`, `ReadingSurface`, `MapShell`. A status badge at 12 pixels.
- **Formatting.** `lib/format` for numbers, percents and dates, pinned to one locale.
- **Global reduced-motion rule.**
- **Guards.** Extend the class guard to all prefixes and add the reverse check. Add guards for arbitrary font sizes, raw status colours and bare `toLocaleString()`. Delete the 49 dead classes.
- **A written design reference.** One page in `openplan/docs/` listing tokens, primitives and the route-to-archetype table. None exists today.

### Phase 2. Shell and navigation

Depends on decisions D1, D3 and D4.

- Plain full-width page for non-map routes; window scroll; map shell for map routes.
- Phone navigation: four destinations plus a labeled "More" sheet.
- Rail: regroup and rename per D4. Move Workspace setup and Planner Agent Activity to an account menu.
- `PageHeader` on every route, with breadcrumbs on record pages. Every title equals its rail label, enforced by a test.
- Header "New" buttons open the wizard directly.
- Command palette searches records.

### Phase 3. Pages by archetype

- **Record hub** (new): project, plan, program, model, scenario set, campaign, RTP cycle, report, mission. Breadcrumb, title, one status line, URL tabs, one unboxed column per tab, a "Linked records" tab. Closed tabs unmount. The local-support panel moves to a tab or a one-line chip (D5).
- **Worklist:** dashboard, My Work and the registries. Stat tiles in one row. One command board, on the dashboard only.
- **Reading surface:** report content, help, legal pages, extraction chapters, land use public pages. Add a print stylesheet.
- **Map-first:** Corridor Analysis and Aerial move onto `MapShell`. The rail splits into Setup, Layers and Results.
- **Guided flow:** convert the remaining inline creators, starting with land use plan, client invoice, measure fund setup and network package upload.

Suggested order: project, then report, then model, because those three carry the most weight today.

### Phase 4. Copy

- Extend the guard to props and string literals before rewriting, so progress is banked.
- Add the second dialect to the ledger.
- Delete the 45 build notes. Shorten the 112 long strings. Settle one verb each for create, save, remove and reload.
- One status vocabulary. One pattern for read failures at about 25 words.
- Move raw error text behind a disclosure for whoever runs the installation.
- Remove em dashes from rendered copy.
- This phase needs your vocabulary answers (D6). Past passes went wrong when an agent guessed planner terms.

### Phase 5. Maps and data

- One ramp file: single-hue classed ramps per measure, fixed breaks, a no-data colour, step expressions so legend and map match.
- One legend with title, unit, breaks, no-data entry, source and year.
- Click to select, with details in the docked sidebar. A "View as table" toggle on Safety and traffic volume.
- Charts with axis ticks and units. Move engagement bars onto the shared primitives.
- A claim-tier chip with one line of "what this supports," and full caveats behind a disclosure.

### Phase 6. Public and first run

- Home page: one real screenshot of a scored corridor and one of the portal map, a wordmark, one tagline.
- Agency-facing public pages in their own layout with no OpenPlan marketing.
- Portal: collapsed language control, 44-pixel targets, sheet that shrinks on the "where" step, per-locale `lang` and `dir` on `<html>`.
- Sign-up: no second login, no organization field for invitees, plain error text, resend confirmation.
- Help: one section per module, linked from each page header.

### Phase 7. Conformance and observation

- Keyboard and screen-reader walk of the core journeys. Label the 73 unlabeled controls. Announce errors in the 65 files.
- Refresh the card-nesting budget and run all five browser audits.
- Observe at least one practicing planner and one resident. Agent journeys cannot establish usefulness.

## 7. Decisions needed from Nathaniel

| # | Decision | Recommendation |
|---|---|---|
| D1 | Keep the wallpaper map behind ordinary pages, or retire it | Retire it for non-map pages. It costs 38 percent of a phone screen and adds a frame to every page. Keep the full map on map surfaces. |
| D2 | Add a fifth archetype for record pages | Yes: "record hub." The project page already has most of the shape. |
| D3 | Default theme | Follow the device setting, with light for public plan pages and print. Dark stays one click away. |
| D4 | Rail names and grouping | One "Plans" entry with a type filter. Show Scenarios and Model Validation under Travel modeling. You name "Programming Cycles." |
| D5 | Where the "Can OpenPlan do this here?" panel lives | A one-line chip in the header that opens the detail. |
| D6 | Vocabulary | Your word for each of: "retain" as a save verb, "engagement" in Invoicing, "unassessed" versus "unresolved," "queue action," "packet," "campaign" versus "consultation." |
| D7 | Body typeface | Keep Space Grotesk for headings. Use a reading face for body text. Public Sans and Source Sans 3 are free and built for government text. |
| D8 | "Nat Ford Planning" in the footer and social image | Your call. |
| D9 | Scope authorization | Roadmap line 80 requires a scoped decision for redesign. Phase 0 is bug repair and does not need one. Phases 1 to 7 do. |

## 8. Existing records this review builds on

- `openplan/docs/PLAIN_WORDS_FEWER_BOXES.md`: the interface standard. This report proposes one amendment, the fifth archetype.
- `docs/product/CORE_REQUIREMENTS_LEDGER.md`: CORE-APPEARANCE-01 and -02, CORE-INCLUSIVE-01, CORE-ENG-01.
- `docs/ROADMAP.md`: M2c appearance additions, M9 accessibility target, W1 website.
- `docs/ops/KNOWN_ISSUES.md`: about 30 UI rows. Phase 0 closes KI-2026-09-05-062.
- `docs/reviews/OPENPLAN_V1_CODEX_REVIEW_2026-08-25.md` and `docs/reviews/TECHNICAL_PRODUCT_REVIEW_2026-09-06.md`: earlier findings on navigation count and density, consistent with this one.

## 9. Evidence index

Screenshots are in `evidence/`. All are from the local test workspace.

| File | Shows |
|---|---|
| `01-dashboard-dark-1440.png` | Shell, rail, floating panel, default theme |
| `02-dashboard-390.png` | Phone: 160-pixel header, icon-only navigation, three nested frames |
| `03-project-detail-1440x3000.png` | Local-support panel above the project; stacked stat tiles |
| `04-project-detail-390.png` | Phone record page inside the 568-pixel window |
| `05-grants-1440x3000.png` | Seven stacked tiles; catalog columns one word wide |
| `06-rtp-1440x3000.png` | Nesting depth five; builder vocabulary in a registry |
| `07-report-detail-1440x3000.png` | Report as a control stack, not a document |
| `08-explore-light-1440x2600.png` | Dark slab in light mode; unreadable tiles |
| `09-model-detail-light-1440x2600.png` | Red and green ramps; stat tiles with wrapped text |
| `10-safety-1440x3000.png` | The working map-first page; caveats as stacked paragraphs |
| `11-planner-agent-light.png` | Drawer ignores light mode; uppercase chips |
| `12-home-1440.png` | Text-only home page |
| `13-sign-in-390.png` | Form below the first screen |
| `14-portal-1440.png` | 21 language chips above the title |
| `15-portal-390.png` | Map-first phone portal |
| `16-dashboard-light-1440.png` | Light mode, for comparison |
| `rendered-metrics.json`, `capture.js` | Per-route measurements and the script that made them |
