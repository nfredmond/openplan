# OpenPlan roadmap and documentation audit, 2026-08-11 to 2026-10-11

This audit uses `origin/main` at `c735abec3`, the merge of PR #206. The local checkout HEAD (`05dd3e8da`) is 15 commits behind, and the earlier attempt's scratch roadmap matched HEAD, so I re-extracted the files (`scratch/ROADMAP.main.md`, `scratch/LEDGER.main.md`). Nothing in the repository was changed.

## Bottom line

1. **The roadmap was updated often but not kept current.** 194 commits touched `docs/ROADMAP.md` in the window.
   - In a 15-commit sample: 3 changed direction, 7 added a dated evidence paragraph or link, and 5 only changed header metadata.
   - Across all 194 commits, 51 changed only the header.
2. **The headers match the package but the content does not.** The `current_release: v0.68.0` field matches `openplan/package.json`, tag `v0.68.0` and the GitHub "Latest" release.
   - It matches because `openplan/scripts/ops/product-direction-review.mjs` (lines 403–434) fails unless the roadmap, contract, matrix and registry all equal the package version.
   - Release commit `10c3bc0ca` bumps all four headers with no review. The roadmap body never mentions v0.67; v0.68 appears only in the header.
   - The roadmap still says the package "remained v0.66.0" (line 46).
   - The capability matrix body still calls v0.44.0 "an unreleased candidate" (line 39).
3. **The October 10–11 changes are missing from the roadmap, the contract and most of the ledger.** These are:
   - the hosted public launch (Vercel and Railway, $50/month authorized);
   - the Maps module (Fable 5.1 map packages);
   - UI overhaul 1–4;
   - the engagement map sweep: place search, a map with no Mapbox key, 21 languages, meeting-room limits;
   - the model-default policy.

   The roadmap (line 115), V1 contract (line 22) and KNOWN_ISSUES (lines 6–7) all still say Vercel is inactive and hosting is deferred.
4. **Where the roadmap actually sits.** Engineering is far along in a narrow band:
   - OWP administration (M2d)
   - contract budgets (M11)
   - engagement response and synthesis (M9a/M9b)
   - provider choice (A0)
   - recovery work (M3)

   These are barely started or not started: M10 capital, M12 RTP, M13a–d tax and grant administration, M14 procurement, M7 land use, M8 environmental, M5b aerial, G1 geography, A1b–d agent assignments, S3 validation and V1. The capability registry still shows 0 proven, 37 partial and 62 not-assessed cells, unchanged since 2026-09-06 and past its 2026-10-05 review date.
5. **A reader cannot find the next three things.** The October 6 "immediate workflow sequence" (lines 56–72) was mostly finished by October 8 and nothing replaced it.
   - An older September 7 queue (lines 136–143) still sits in the file.
   - The 13 PRs merged October 10–11 fall outside the queue, and the hosted relaunch contradicts it.
6. **The documentation volume is not sustainable.** `docs/` grew from 93 tracked files on August 11 to 6,096 on October 11 (127.2 MB).
   - 3,421 of those files landed between October 6 and 11, and 98% sit under `docs/reviews/`.
   - Following AGENTS.md means reading about 52,700 words before starting work.

## 1. Roadmap currency

### 1a. Commit sample (every 13th of 193 commits)

| Commit | Date | Class | Change |
|---|---|---|---|
| ea65534bd | 10-11 | Evidence | New M3 "selected-root snapshot" paragraph |
| 424fe6b12 | 10-07 | Evidence | M1 report-recovery link, boundary wording |
| 266c1db8c | 10-07 | Evidence | M1 plan-kind link |
| f14b9dff8 | 10-06 | **Substantive** | New direction review and the October 6 queue |
| cab612135 | 09-30 | Evidence | M9 link swap, "next" pointer moved |
| 28be41642 | 09-14 | Evidence | v0.60 header bump plus an appended release paragraph |
| 3abe14558 | 09-12 | Metadata | `current_release` v0.55.0 to v0.55.1 |
| d87a04d42 | 09-10 | Evidence | v0.49.2 link added to A1a |
| adcda9725 | 09-09 | Evidence | v0.47 header bump plus a link |
| 89d50c010 | 09-07 | **Substantive** | Next-work order moved from M2d.2 to M11a |
| 8203a92cc | 09-06 | Metadata | `reviewed_commit` changed |
| 6fe3ab9e9 | 09-05 | Metadata | `reviewed_commit` and review path changed |
| 3f4413e97 | 08-28 | Metadata | `reviewed_commit` changed |
| a86d3e22d | 08-28 | Metadata | `reviewed_commit` changed |
| cb445c4b0 | 08-25 | **Substantive** | "Coherent path to v1" rewrite (252 lines added, 235 removed) |

Across all 194 commits (`scratch/roadmap-commit-classes.txt`): 51 header-only, 120 small body edits and 23 larger ones.
- Of the 23 larger commits, 13 fall on August 24–28. Only four after September 6 change direction: `c4f76eb02`, `0a9e31adb`, `f14b9dff8` and `126ff41d0`.
- `docs/ROADMAP.md` did not exist until August 24, so no roadmap commits exist for August 11–23.
- The August 28 to September 6 commit-hash rewrites are what AGENTS.md line 28 now forbids: "changing its date or commit is not new evidence."

### 1b. Header check

- **`current_release` v0.68.0** matches the package, the tag and the GitHub release, but only because the guard forces a mechanical bump.
- **`reviewed_commit` 380aad49** is the October 6 review commit, and that review records `current_release: v0.66.0`.
- **The direction check exits 0 with five reminders.** I read `product-direction-review.mjs` first and confirmed it only reads files and runs read-only git commands. I ran it with `GIT_OPTIONAL_LOCKS=0` against the working checkout, not `origin/main`. The reminders are:
  - jurisdiction registry expired 2026-09-28;
  - capability matrix and registry expired 2026-10-05;
  - the review covers v0.66 while the package is v0.68;
  - substantive files changed after the review.

### 1c. Milestone table

"Engineering" means synthetic, agent-run evidence. The September 9 policy says human review does not gate releases, but every milestone's own Done line still requires human observation. That is why nothing below is fully "done".

| ID | Roadmap says | Code, PRs, ledger show | Verdict |
|---|---|---|---|
| M0 | "M0 maintenance completed" (l.138); Oct 6 item 1: merge synthesis work | #115 merged. ARCHITECTURE and KNOWN_ISSUES dated Sep 6; matrix expired | Partial, slipped since Sep 7 |
| M1 | Long Oct 7 evidence list; "does not close M1" (l.178) | #123–131, #133, #138. One synthetic specific plan; the Oregon/California, multistate MPO and tribal cases not run | Partial |
| M2 | Outcome text only | No cross-module case | Barely started |
| M2a | Template taxonomy | Zero commits to `src/lib/work-plans` since Sep 7 | Barely started |
| M2b | File library | One commit since Sep 7 | Barely started |
| M2c | Signal palette and corner style "not implemented" (l.208) | #186 device theme, #187 dashboard; no Signal palette or corner selector in source | Partial |
| M2d | d.1–d.2 engineering accepted, d.3 v0.47, d.4 v0.48 | 15+ work-program migrations, recovery | Mostly done (engineering) |
| M3 | Six dated paragraphs Oct 8–11, "remains open" | About 24 PRs (#157–170, #174–178, #184, #190, #197, #199–204). No clean install, cross-host restore or 45-minute computation. Hosted install sits outside the roadmap's framing | Partial |
| M3a | Desktop Control | `openplan-control-panel.py`, Sep 6 and Sep 9 repairs; GUI acceptance open | Partial |
| M4 | No evidence | No retention, legal-hold or records-request code | Barely started |
| M5 / M5a | Exchange and formats | v0.36 GeoPackage export and evidence bundles; no format matrix | Partial / Barely started |
| M5b.1–6 | Long scope | Research only; one aerial commit since Sep 7 | Barely started |
| M6 | Multimodal and safety | Crash sources are CCRS (California) and fatal-only FARS (`registry.ts` l.36) | Partial |
| M6a / M6b / M6c | Transit / BCA / prioritization | Zero transit commits since Sep 7 / v0.67 BCA (#118) / no code | Barely started / Partial / Not started |
| M7 | Land use and development review | No development-review workflow | Barely started |
| M8 / M8a / M8b | Environmental, NEPA/CEQA, civil rights | Templates only; zero `title-vi` commits since Sep 7 | Barely started / Not started / Not started |
| M9a | Publish and participate | Sep 7 cases plus Oct 10–11 map sweep (#185, #194–196) | Mostly done (engineering) |
| M9b | Moderate, interpret, respond | v0.56–v0.66, Oct 7 manual case, queue PRs | Mostly done (engineering) |
| M9c / M9d | Superiority trial / hearing record | None | Not started / Not started |
| M10 (incl. a.1–d.2) | Capital administration | No construction or pay records; award-obligation review only (#141, #145, #147, #148) | Barely started / Not started |
| M11 | v0.46–v0.47 | Contract, forecast, settlement and closeout migrations | Mostly done (engineering) |
| M12 | Prior-RTP update | Extraction predates the window; no M12a work | Barely started |
| M13 / M13e / M13f | Tax and grants / grant discovery / audits | `local_measure` but no recipient isolation / Grants.gov search and BCA / none | Barely started / Partial / Not started |
| M14 | Procurement, both sides | Consultant pursuit only (from July) | Barely started |
| M15 | "Mid-term"; Vercel inactive (l.115, l.142) | Live public site Oct 11, Railway workers, $50 cap; no trial isolation or customer transfer | **Contradicted**. Actual: M15a mostly done, M15b partial, M15c not started |
| S1 / S2 / S2a / S3 | Science lanes | Oct 8 custody work / negative v0.39–v0.44 studies / TimesFM research note / preregistration still blocking | Partial / Partial / Not started / Not started |
| G1 / G1a | Coverage | 3 jurisdictions; 0 proven cells; 9-state research only | Barely started |
| A0 | v0.52–v0.55 | Codex, Claude Code, OpenCode and API project task shipped. Broad chat is still Anthropic-only (`chat/route.ts` l.4); no OpenCode OAuth | Mostly done |
| A1a / A1b / A1c / A1d | Agent assignments | v0.49.1–v0.51 / no assignment tables / depends on A1b / no MCP server | Partial / Not started / Not started / Not started |
| V1 | Whole-product campaign | Not run | Not started |
| W1 | "On hold, ask before resuming" (l.774–778) | Website PR 20 redirect merged Oct 11 under Nathaniel's authorization | **Contradicted** |
| Not in roadmap | Maps module, UI overhaul, model policy | #186–189, #193. HOSTED_LIVE l.81 calls the map-package migration "M17", which the roadmap never defines | Untracked work |

PR coverage caveat: there are no PRs between #99 (Jul 22) and #100 (Sep 6), or between #111 (Sep 9) and #112 (Oct 2).
- 466 commits landed directly on main from Aug 11 to Sep 5, and 263 from Sep 10 to Oct 1.
- For those periods I used CHANGELOG, tags and `git log`.

## 2. Contradictions

1. **The V1 contract and the release policy disagree on hosting.** `V1_PRODUCT_CONTRACT.md` l.22 says hosting is deferred and Vercel inactive. `HOSTED_LIVE_2026-10-11.md` l.7 says the site is live, and `DEVELOPMENT_RELEASE_POLICY.md` l.6–9 and 76–86 supersede the deferral.
2. **The roadmap contradicts current operations.** `ROADMAP.md` l.115–116 says the Vercel repository connection is removed. In fact `vercel.json` deploys `main`.
3. **KNOWN_ISSUES is stale.** Lines 6–7 say Vercel is inactive, and line 10 says "Reviewed 2026-09-06 against unreleased v0.44.0". There are no sections for v0.64, v0.67, v0.68 or hosted issues (Gmail spam placement, clipped scenario page, untested volume restore).
4. **ARCHITECTURE is five weeks stale.** Line 3 says it was reconciled Sep 6 and line 129 says "Proposed hosted preview". Line 79 says the maps use Mapbox only, but the public map now runs without a key (`open-map-style.ts`).
5. **The capability matrix header and body disagree.** The header claims v0.68.0 (l.6), but the body says "0.44.0 remains an unreleased candidate" (l.39), and `review_by` 2026-10-05 has passed.
6. **The same review is cited at two versions.** The roadmap header binds `380aad49` at v0.68.0. The October 6 review (l.7) binds the same commit at v0.66.0, and roadmap l.46 says "remained v0.66.0".
7. **The ledger is behind the code.** `CORE_REQUIREMENTS_LEDGER.md` l.33 (CORE-ENG-01) says "Address search and a key-free map remain". Both shipped in #185 and #196 (`place-search.ts`, the key-free map test).
8. **The CHANGELOG Unreleased section contradicts itself.** Line 57 says "A public map without a Mapbox key". Line 183 says "Not done: a map that works without a Mapbox key".
9. **The ledger understates hosting.** l.42 (CORE-HOST-01) says public commissioning is unproved and only "ingredients exist", but the site is live with signups, workers and real jobs.
10. **The roadmap missed the website redirect.** W1 still says "on hold" while the redirect is already merged.
11. **README.md leads with an old result.** Lines 11–14 lead with the September 6 nine-of-twelve result and give no hosted address.
12. **AGENTS.md l.157 is stale.** It still says "zero users as of September 7", but public signups opened October 11.
13. **There are two "current" modeling status files.** AGENTS.md l.72 points to `ACTIVITYSIM_RUNTIME_GAP.md`, while docs/README l.78 says the current status is `STATUS_AND_VALIDATION.md`.
14. **docs/README routing is buried and points at stale files.**
    - Line 11 still says the October 6 audit records the next boundary.
    - The "Current authorities" heading (l.15) holds October 8 model checkpoints.
    - The routing table does not start until l.29.
    - It sends readers to the stale matrix and KNOWN_ISSUES (l.34).
15. **The deployed version string hides what users see.** The hosted site reports 0.68.0 while running a 166-line Unreleased section: Maps, model defaults and 21 languages.
16. **The memory index starts from a dead plan.** It still opens with the August 25 "v1 roadmap" (stranger test, four releases). The repository replaced that plan 94 minutes later with commit `c9b771cd2`. This is outside the repo.
17. **The roadmap and ledger now both log M3 evidence.** The ledger does so at l.349–453 and the roadmap at l.255–275. That means two places to update for every increment, and they already drift (item 7).

**CHANGELOG versus tags is consistent.** Every 0.x heading has a tag except 0.1.0, and GitHub releases exist through v0.68.0. Dates are off by one day only for v0.67.0, v0.49.0 and v0.43.0, a time-zone effect.

## 3. Roadmap shape

- **Length.** 855 lines and 24,007 words. The largest sections are:
  - Destination and sequencing: 1,218 words
  - M2d: 1,197
  - M9: 1,121
  - M13: 1,001
  - M14: 990

  The median milestone is about 300 words.
- **Done definitions.** 48 of 50 milestone sections have a Done line. Almost all require practitioner or public observation, which the September 9 policy says does not gate development. As a result an agent-only team can close no milestone. "Remains open" or its equivalent appears 56 times.
- **Owners and status.** No milestone has an owner, a status field or a summary table. Status lives in 49 dated paragraphs and 118 links into `docs/reviews/`. Release notes for v0.56–v0.66 sit under "Human observation and product decisions" (l.792–855).
- **Sequence.** Line 132 says milestone numbers do not set the order. There are two numbered queues, and the October 6 queue has had no successor since its items were done around October 7–8 (l.77–106).
- **PRs after October 6.** 82 PRs merged (#115–#207). By the October 6 queue:

  | Queue item | PRs |
  |---|---|
  | 1. M0 | 1 |
  | 2. M9b generation | 9 |
  | 3. Engagement journey | 6 |
  | 4. M2d, M10–M14 | 6 |
  | 5. M1, M3–M8, S1–S3 (24 of them M3, 11 M1) | 38 |
  | Releases | 3 |
  | Fixes | 6 |
  | Outside the queue: hosted #191/#192/#198/#206, UI #186–188/#193, engagement map #185/#194–196, Maps #189 | 13 |

  M10, M12, M13a–d and M14 got no PRs. Item 5 covers nearly everything, so the 69 PRs that "fit" the queue show little discipline.
- **The August 25 four-release plan.** It lived in the roadmap for about 94 minutes (`0c06007e5` at 17:37 to `c9b771cd2` at 19:11) before the "ultimate" contract replaced it.
  - **v0.35, serious injuries outside California:** not delivered. v0.35 shipped navigation and safety road context instead.
  - **v0.36, get the work back out:** partly delivered (GeoPackage export and evidence bundles).
  - **v0.37, one agency, many people:** partly delivered (governed approvals and My Work queues).
  - **v0.38, model presentation:** turned into observed-count validation custody.

## 4. Documentation sprawl

`docs/` on main holds 6,096 tracked files (127.2 MB). The working tree has 6,308, including untracked files from other sessions, and `openplan/docs` adds 123.

| Top-level folder | Files | MB |
|---|---|---|
| reviews | 5,856 | 124.7 |
| ops | 155 | 1.1 |
| modeling | 44 | 0.6 |
| archive | 22 | 0.2 |
| product | 12 | 0.2 |

**By type:** json 2,504, log 1,083, md 860, py 821, png 413 (86.2 MB) and sql 119. About 1,100 executable files sit inside `docs/`.

**Growth:**

| Date | Tracked files in docs/ |
|---|---|
| Aug 11 | 93 |
| Aug 25 | 163 |
| Sep 6 | 454 |
| Sep 14 | 2,156 |
| Oct 6 | 2,675 |
| Oct 11 | 6,096 |

Three folders hold 2,861 files: land-use-authority (1,483), model-custody-metadata (713) and gtfs-managed-ingestion (665). There are 110 dated review folders.

**What a newcomer gets.** The August 25 review named "209 dated evidence records" as a weakness; the count is now about 29 times that. Following AGENTS.md means about 52,700 words of required reading, plus 9,812 for the ledger. After all of it, a newcomer still does not learn that a hosted site exists, what v0.67 and v0.68 shipped, or what to do next.

## 5. Ledger accuracy (12 CORE ids)

All linked evidence exists on main, and the 11 unlinked filenames resolve to `docs/reviews/2026-09-04-pre-handoff/`. The claims check against code as follows:

| ID | Verdict | What the code shows |
|---|---|---|
| CORE-PM-01 | Supported | Contract migrations `20260911…`; settlement/closeout `20260915…` |
| CORE-OWP-01 | Supported | Work-program migrations from 20260906 to 20261004 |
| CORE-RTP-02 | Supported | `rtp/extraction/chapter-blocks.ts` exists; no M12a work |
| CORE-ENG-01 | **Contradicted by code** | Place search and the key-free map both shipped |
| CORE-ENG-03 | Supported | Moderation and response code present |
| CORE-ENG-04 | Supported | Export and report routes; the hosted job produced PDF, XLSX and ZIP |
| CORE-AGENT-01 | Supported | Chat is Anthropic-only; Codex and OpenCode connectors present. The row omits the Maps connector and the model policy |
| CORE-HOST-01 | **Stale** | Public install is live |
| CORE-APPEARANCE-01 | Supported | Signal not built; device theme test present |
| CORE-APPEARANCE-02 | Supported | No corner selector |
| CORE-OPS-CONTROL-01 | Supported, slightly stale | Control panel present; the September 9 repair is not cited |
| CORE-FUNDADMIN-01 | Supported | No recipient-organization isolation |

Result: 9 supported, 1 contradicted, 1 stale and 1 slightly stale. The last six ledger sections are M3 evidence entries, not requirement changes.

## 6. What "properly and continually updated" would look like, and the gaps

**What it would look like:**
1. A status table at the top of the roadmap: milestone, status, last evidence, owner, next action. It changes only when status changes.
2. A dated "next three" list, refilled whenever an item closes.
3. Release notes kept only in CHANGELOG.
4. Any change of direction (hosting, a new module, a policy change) updates the contract, roadmap, ledger, KNOWN_ISSUES and ARCHITECTURE in the same PR.
5. The direction check compares each header to the review that actually happened, instead of forcing every header to equal the package version.
6. Raw logs, JSON and screenshots move out of `docs/` into release assets or a separate evidence store, linked by hash.

**Gaps found:**
- **There is no single place that records status.** It is spread across 49 dated paragraphs and 118 links.
- **The guard forces stale headers.** `product-direction-review.mjs` l.403–434 requires header bumps that produce misleading metadata (see commit `10c3bc0ca`).
- **Expired inputs pass the check.** The matrix, registry and jurisdiction registry are all past their review dates, and the check still exits 0.
- **The October 10–11 changes never reached the product documents.**
- **The queue has been empty since about October 8.**
- **KNOWN_ISSUES and ARCHITECTURE have not been reconciled since September 6.**
- **Session coordination notes sit in the roadmap.** Lines 267–275 say "preserve the relaunch owner's main hold".
- **Migration filenames look like dates but are not.** `20261017000001` exists on October 11, and `20261011000002` shipped on September 12. This misleads anyone reading the hosted records.

## What I could not determine

- **How the verdicts were reached.** They rest on CHANGELOG, tags, PR titles, migration names, file presence and commit counts by path. I ran no tests, did not open the app and did not read most review folders.
- **What "not started" means.** I found no matching code; something under a different name could exist.
- **Queue assignments.** Sorting PRs into October 6 queue items was my judgment from their titles.
- **v0.36–v0.38 completeness.** I did not confirm how fully those releases met their August 25 done lines.
- **Process slip.** I briefly wrote two working files to `/tmp` and then moved them into `scratch/`.