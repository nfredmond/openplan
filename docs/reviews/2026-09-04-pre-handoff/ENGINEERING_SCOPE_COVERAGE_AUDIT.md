# Engineering scope coverage audit

September 4, 2026. Bounded read-only review of the renewed `ROADMAP_DRAFT.md` and `CORE_REQUIREMENTS_LEDGER.md`, existing implementation seams, archived commitments and GitHub PR descriptions. No implementation, browser journeys, tests, database calls or runtime changes. The sole written artifact is this report.

Local HEAD observed during the concluding source checks: `c64b70b6b474130ab7a88e0ca4d78fcaaf8b9e4a`. Other development continued; this was a working-tree sample, not an immutable checkout snapshot. Reconcile current source before implementing any item below. The renewed draft/ledger are scratch proposals, not automatically the active product authority.

## Result

The renewed roadmap preserves the broad v1 destination and restores the recently named contract, RTP, funding-administration, procurement and hosting requirements. The main remaining risk is **completion scope hidden inside broad milestone language**. Eight candidates below should become explicit acceptance work in their existing milestones. Most are under-specification, not evidence that a user explicitly requested a particular new feature and it was deleted.

Do not create eight new modules or restore old release ordering. In particular, the sampled evidence does not authorize a general CRM replacement, a real-time Google Docs clone, live vehicle dispatch, autonomous aircraft operation or a universal integration marketplace.

## Inventory and evidence limits

- Reused `github-pr-inventory.json`: 99 historical PR records, largely updated July 22, 2026. Titles were used to select deeper reads, not as proof of current behavior.
- Fresh read-only `gh issue list --state all --limit 100` returned **zero issues** for `nfredmond/openplan`. This result does not prove that every historical request was captured in GitHub.
- Freshly read PR bodies: [#12 admin action activity](https://github.com/nfredmond/openplan/pull/12), [#40 BCA/TDM](https://github.com/nfredmond/openplan/pull/40), [#42 Grants.gov discovery](https://github.com/nfredmond/openplan/pull/42), [#47 persisted BCA evidence](https://github.com/nfredmond/openplan/pull/47), [#51 GTFS transit LOS](https://github.com/nfredmond/openplan/pull/51), [#81 report narrative export](https://github.com/nfredmond/openplan/pull/81), [#86 aerial processing contract](https://github.com/nfredmond/openplan/pull/86). Their historical test/acceptance claims were not rerun or adopted as current proof.
- Inventoried current pages, APIs, libraries and dated documents before selecting code reads. Reviewed relevant sections of the current/archived `docs/ROADMAP.md`, `docs/product/V1_PRODUCT_CONTRACT.md`, ADR-004, and the August 25 review/roadmap; inspected current report drafts, priority scoring, portfolio round-trip, My Work, integration registry, aerial export/custody and transit work-plan seams. Selected source files were read fully or by relevant sections; this was not a complete audit of those modules.
- The existing requirement ledger was reviewed as the current mapping, not treated as proof that all workflows exist. No raw conversation histories, client records or secrets are reproduced here. No current statutory or SDK correctness determination is made from an old comment or ADR.

## Eight high-value completion-scope candidates

### 1. Aerial collection and processing must finish as usable planning evidence

**Recorded scope:** the prior roadmap's connected practice includes aerial evidence (`docs/ROADMAP.md:84`, `:255`), and the product contract places it alongside the project spine (`docs/product/V1_PRODUCT_CONTRACT.md:162`). PR #86 deliberately shipped dispatch/callback infrastructure, not a complete evidence-quality judgment.

**Current foundation:** `openplan/src/lib/aerial/flight-exports.ts:1` now builds saved-snapshot WPML/KMZ, Litchi CSV and review KML; `survey-grid.ts`, `artifact-custody.ts`, `processing-contract.ts` and `reports/aerial-ortho-evidence-server.ts` connect mission, worker and retained imagery. This is substantially beyond the April 18 prototype. That dated document's “no actual DJI schema/no ODM” statements are superseded as descriptions of the source; actual aircraft import compatibility and processing usefulness still require appropriate validation.

**Renewed mapping:** M3 covers worker/recovery and M5 GIS; neither explicitly owns the complete aerial planning job. Add an aerial case to **M5**, with M3 operation, M2 decision/report handoff and M10 construction evidence where applicable.

**Concrete done:** an authorized operator imports or plans a permitted survey, preserves actual collection parameters/source and geographic accuracy limits, processes it, reviews quality/georeference, compares it with the planning site, and hands retained imagery plus interpretation to another planner. Distinguish export bytes, compatible pilot-app import, flight authorization, processing success and suitability for a measurement claim. Test wrong CRS/bounds, stale flight snapshot, failed/duplicate callbacks, expired vendor URLs, missing artifacts and replacement imagery without rewriting a frozen report. A pilot/GIS practitioner must judge the actual handoff. This does not require OpenPlan to become flight-control software.

### 2. Project prioritization needs a governed method and a reproducible selection decision

**Recorded scope:** project prioritization is explicit in `docs/product/V1_PRODUCT_CONTRACT.md:55`. The current RTP score implementation turns criterion ratings into a composite and public rationale, so ranking is already a consequential product behavior.

**Current foundation:** `openplan/src/lib/rtp/priority-scoring.ts:1`, `priority-criteria.ts`, `priority-frameworks.ts` and `priority-framework-binding.ts`. The inspected scoring code uses the common fixed taxonomy/weights; missing ratings contribute zero to the full denominator, while reporting the number scored. Its own comment says changing framework weights requires moving the denominator/computation together. This is an implementation choice to review, not proof that the current result violates a particular adopted policy.

**Renewed mapping:** **M12b/M12c and M5**, linked to M6/M13. The draft describes stable policies and selected alternatives but does not clearly require an agency-approved scoring method and a retained selection run.

**Concrete done:** preserve criteria, weight/scale, method edition, eligible candidate set, supporting evidence, incomplete ratings, reviewer judgment and approved exceptions; reconstruct why a project advanced and what was excluded. Distinguish an ordinal policy score, monetary BCR and a constrained funding decision. Sensitivity to allowed weight/assumption changes and explicit unknowns must remain visible. Test changed criteria after selection, missing-data penalties, tied scores, duplicate projects and a project with several funding lines. Have a programming/board-packet practitioner reconstruct the decision. Agency-controlled methods are a recommended means of satisfying existing prioritization scope, not a claim that a particular custom-weight editor was previously promised.

### 3. Benefit-cost and TDM screening need their own defensible analysis-to-application outcome

**Recorded scope:** PR #40 explicitly introduced the BCA/TDM worksurface, downloadable memo, parameter disclosures, sensitivity and uncertainty calculations; PR #47 made saved results durable project evidence for grant narratives. Both distinguish screening from a complete funder-specific application analysis.

**Current foundation:** `openplan/src/lib/bca/{engine,parameters,monte-carlo,render,types}.ts`, `lib/tdm/`, `lib/grants/bca-evidence.ts`, and `app/api/projects/[projectId]/bca-screenings/route.ts`. Parameter source text exists; its presence is not proof that the selected edition applies to a future application.

**Renewed mapping:** add explicit completion criteria to **M6/M5**, with M13/M14 funding/pursuit use and M12 programming. Generic “costs and effects” can be satisfied without ever inspecting the BCA memo.

**Concrete done:** a permitted project retains baseline/build quantities, source years, monetary price basis, discount assumptions, cost timing, benefit exclusions and possible double counting, together with sensitivity and reviewer disposition. Reopening a saved analysis reproduces its memo and downstream facts; an updated parameter edition creates a new version. Verify incompatible units, missing baseline VMT, mutually overlapping TDM benefits, horizon truncation, zero/negative denominators and an unavailable source. A qualified analyst determines whether additional program-specific work is necessary. Refresh consequential official parameters at implementation; do not certify the current defaults from this audit.

### 4. Transit planning is more than importing GTFS or estimating transit LOS

**Recorded scope:** transit organizations and transit planning are explicit contract contexts (`V1_PRODUCT_CONTRACT.md:43`, `:52`). The current `openplan/src/lib/work-plans/templates/transit_development_plan_v0.1.json` names existing service/fleet/facilities, route/time productivity, rider needs, alternatives, resource implications and board adoption.

**Current foundation:** GTFS libraries, feed/version APIs, model transit handoff and the above work-plan template. PR #51 describes a headway-based model LOS contribution and explicitly disclaims validated transit assignment. “Roadmap F complete” in that historical PR does not close the transit planning practice.

**Renewed mapping:** **M6**, with M11 operator resources, M9 engagement and M8 applicable equity/environmental work. M6 already includes calendars, transfers and modal decisions; strengthen it with an observed **operator service-plan case**.

**Concrete done:** connect an operator's ridership/productivity and service inventory to feasible service alternatives, operating/capital resource implications, rider review and adopted implementation. An operator may supply externally validated analysis; OpenPlan must retain its origin and limitations. Test seasonal/no-feed/rural contexts, missing actual ridership versus scheduled service, resource shortfalls and changes across service days. Do not add real-time dispatch, fare collection or mandatory fleet telematics without separate evidence of scope.

### 5. Shared human report authoring and review need acceptance beyond generating a packet

**Recorded scope:** documents/reports and external document-management handoff are explicit in the contract and old roadmap (`V1_PRODUCT_CONTRACT.md:57`; `docs/ROADMAP.md:379`). M12 restores substantial RTP authoring, but the rest of planning practice also produces reports and memoranda.

**Current foundation:** `openplan/src/lib/reports/narrative-drafts.ts:1` preserves drafted/accepted/dismissed narrative, authorship and a facts hash. `app/api/reports/[reportId]/narrative-draft/[draftId]/route.ts` and `components/reports/report-narrative-draft-panel.tsx` permit reviewed human edits. PR #81 specifically protects generated engagement narrative exports. These are useful seams; they do not establish a complete multi-author editing/review experience.

**Renewed mapping:** **M2/M5**, reusing **M12** document work. Add a non-RTP technical report or board memorandum to the acceptance set.

**Concrete done:** two authorized people contribute and review narrative, tables, figures and citations; comment resolution and revision history identify what was accepted; concurrent or stale edits do not silently overwrite work; accepted report text and frozen exported artifacts remain distinguishable. Show a reliable human-only authoring path and a usable editable handoff where the actual recipient requires one. Validate long text, source changes after acceptance, interrupted save and independent recipient editing. **No source sampled here establishes a prior promise of live cursors, OT/CRDT collaboration or DOCX specifically**; choose proportionate implementation after observing the job.

### 6. My Work must remain the common cross-module responsibility and recovery inbox

**Recorded scope:** old roadmap mandatory program E explicitly makes My Work the assignment/review/approval/exception/recovery inbox (`docs/ROADMAP.md:387`). PR #12 also established an operator-visible action activity lane rather than requiring database inspection.

**Current foundation:** `openplan/src/lib/my-work/{types,sources,query}.ts` reads owning modules through caller RLS, distinguishes assigned deadlines from unassigned workspace work, and includes moderation, failed models, narrative review, funding deadlines and invoice windows. It discloses source caps and read failures. These choices should survive expansion.

**Renewed mapping:** **M2/M4/M11**, with each new M9–M15 workflow contributing its actionable states. The draft repeatedly lists My Work as a reuse component but does not retain the old explicit app-wide inbox completion gate.

**Concrete done:** staff can find, open and resolve an assigned deliverable, returned claim/proposal, waiting approval, failed background job and overdue agency response from one entry point. Do not infer responsibility from the creator. Distinguish a capped list from a complete inventory and failed reads from “nothing to do.” Test departed staff, revoked access, duplicates across sources, unassigned work and reappearing/stale tasks. A PM and operator should complete a weekly exception review without inspecting every module independently.

### 7. Per-plan archive and document-management handoff need explicit scope beyond GIS/workbook export

**Recorded scope:** old mandatory program D expressly adds **per-plan bundles** and public/governing-body/GIS/spreadsheet/document-management/archival handoffs (`docs/ROADMAP.md:373–381`).

**Current foundation:** project evidence bundles and document-library indexes exist. `openplan/src/lib/projects/portfolio-round-trip-contract.ts:1` defines 19 exported headings but maps ten import columns; `portfolio-import.ts:417` explicitly refuses updates. The August 26 proof records reference-only provenance fields and an empty live portfolio at that checkpoint. That is narrower than a complete project/plan migration, and the distinction is intentional.

**Renewed mapping:** **M5/M2/M4**, plus M12d adopted-plan custody and M15c customer transfer. M5 already promises reviewed updates and compatible reimport: **do not report safe updating as missing**. Specify the field/relationship preservation contract and plan-level archive recipient separately.

**Concrete done:** independently open a plan package with chapters, maps, tables, cited sources, decisions/adoption records and retained bytes; identify exclusions and permissions without relying on the original server. Reconcile imported IDs, cross-document links, amended versions and all monetary/source metadata that the selected exchange claims to preserve. Test missing bytes, unrelated-tenant references, duplicate names/IDs, incompatible schema and partial imports. Do not claim arbitrary vendor DMS connectors are required; a documented standard-format handoff can satisfy the job if the recipient verifies it.

### 8. Localization and low-bandwidth use should remain explicit product-wide proof requirements

**Recorded scope:** old mandatory program E explicitly requires keyboard, screen-reader, responsive, contrast, **localization, print and low-bandwidth** evidence for every core journey (`docs/ROADMAP.md:395–396`).

**Current foundation:** engagement has translation/accessibility components; the report/RTP paths provide print/export surfaces. The current draft's shared definition includes keyboard, screen-reader and print as applicable, and W1 names constrained-network/contrast checks for the marketing website. Those do not explicitly preserve the broader in-app requirement.

**Renewed mapping:** the **shared definition of done and V1/G1**, with M9 public-language cases and M3/M15 constrained-network operation.

**Concrete done:** name supported language/localization scope and manual alternatives, preserve exact source/translated versions, and observe at least the relevant multilingual public participation and staff review cases. Verify contrast, public print artifacts, slower/interrupted connections, upload retry and usable non-map alternatives where needed. A broken translation service must not turn unknown text into approved content. No prior evidence here promises full offline synchronization or a specific number of supported languages; do not invent those requirements.

## Explicitly already covered or superseded

| Item checked | Disposition |
| --- | --- |
| MCP server versus model/backend choice | **Covered distinctly.** A0 owns user API/installed CLI choice; A1 cites ADR-004 and owns read/propose MCP over the action registry. Keep authenticated external-agent identity, progress/cancellation and revocation in A1 acceptance. Revalidate old ADR protocol/package claims before building; do not substitute a provider dropdown for MCP. |
| Public records, confidential originals, legal holds, departure and delegated authority | **Covered in M4**, with M10/M13/M14/M15 lifecycle cases. Audit-table presence alone is not completion, but the roadmap has not dropped the outcome. |
| Contract task/employee budgets, forecasting, RTP predecessor intake, municipal reporting, dual-sided procurement, hosted trials and customer transfer | **Explicitly restored** in M11–M15 and named ledger rows. No need to add duplicate milestones. |
| Safe spreadsheet reconciliation/update | **Already named in M5.** Current create-only import is a retained safety boundary, not a missing button to bypass. Candidate 7 concerns the exact preservation contract and plan/archive scope. |
| External-service configuration and controllable egress | **Broadly covered by M3/A0/M15.** `lib/integrations/providers.ts` currently names Anthropic, Census and deployment-only Mapbox; a saved key is not proof it affects a caller. Bind acceptance to actual calling paths and revocation. No evidence found for a general integration marketplace. |
| Federal grant discovery | **Exists as a bounded seam.** PR #42 documents an on-demand Grants.gov search/track flow, not universal continuously synchronized procurement. M13/M14 should extend that seam with source-specific completeness and amendments, rather than rebuild it or call it complete nationwide coverage. |
| CRM and business administration | Workspace/team, pursuit, engagement, invoice and operations seams exist, but the bounded sources did not establish a standalone general-purpose CRM commitment. M11/M14/M15 capture the supported planning-practice business lifecycle. Do not silently add Salesforce-like marketing/contact automation. |
| Aerial April prototype restrictions | **Several superseded in current source.** Saved flight-plan export formats and processing contract/custody now exist. The missing item is complete observed evidence use, not reimplementing the original dispatcher. |
| Historical “all shipped,” green suites and sample-validated models | **Not current completion evidence.** PR #51's model-F milestone does not close all transit practice; PR #40's BCA screen is not universal application compliance; old gate success cannot close current whole-product requirements. |

## Suggested consolidation

Add concise acceptance clauses for the eight candidates to the mapped existing milestones and a traceability row/group for aerial evidence, prioritization/BCA, shared documents, cross-module responsibility, exchange and inclusive operation. Retain this report as the source/evidence rationale. Prioritize the aerial case and method-governed prioritization/BCA clauses because they are least visible in the renewed queue; reuse the early capital/RTP case to exercise them when appropriate.

Do not use a keyword/count test as proof that scope is preserved. The useful protection is an explicit planner job with a named owner, independent recipient, source record, acceptance artifact and honest status. Future browser/behavioral tests should fail on the actual loss—wrong attribution, missing bytes, hidden failed work, stale method, dropped narrative or unreadable output—and retain a harmless mutation survivor. This audit itself proves no live workflow and performs no such tests.
