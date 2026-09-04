# OpenPlan roadmap to v1

Working draft, 2026-09-04. This becomes the sole active queue only after the current development session's safe handoff and evidence reconciliation. Findings R1-R13 refer to the accompanying product/engineering review. Completed releases and scientific outcomes stay in their dated records, not in the active queue.

## Destination and sequencing

The binding destination remains the complete free, open-source operating system for core US planning practice: every planner and organization context, all 50 states and DC, California as the deepest implementation, separate scientifically validated AequilibraE and ActivitySim results for every published use, coherent self-service workflows, human control and durable free operation. There is no deadline or maximum number of interim releases. Days-long modeling is acceptable when needed for accuracy.

Territories need explicit source, authority and workflow coverage. The existing contract promises a support matrix; the current gate also demands proven territory cells. Nathaniel's clarification of that scope is pending. Do not silently skip those cells or claim territory completeness. Tribal governments, sovereign authority, regional agencies and overlapping jurisdictions are required architectural and practical contexts, not a state lookup exception.

The current 0.44 candidate must first obtain an honest disposition. The source-bound work-loading experiment did not advance overall and remains inconclusive. Publishing that result is useful; it is not evidence that the structural modeling gap closed.

Do not complete a long sequence of modeling releases while everyday planning jobs remain stranded. Conversely, a successful planning handoff does not close the scientific program. At each milestone review, assess the whole capability map, newly found consequential defects, current planner observations and the cost of maintaining disconnected implementations.

The next work, in order of dependency:

1. **M0:** reconcile the active candidate, land this review/documentation and evidence-guard repairs, and restore trustworthy release reporting.
2. **M1:** correct plan-owned authority and California plan-kind requirements.
3. **M3:** repair attempt/liveness integrity and establish the free agency operations reference. Healthy long runs and actual backup recovery are prerequisites for trusting a case.
4. **M2 and M5:** finish one cross-agency case and its reusable selected evidence, using the existing project/plan/GIS/report implementations.
5. **S1:** close scientific custody/comparability prerequisites in parallel with the whole-product work, then select structural experiments from frozen development evidence.

These are outcomes, not automatic release numbers. An implementation may take several releases. Product redesign and new modules below require their own scoped implementation decision; this review does not launch them.

## Shared definition of done

Every milestone must name the planner, organization, actual job, geography/authority, evidence sources, roles and artifact recipient. Record the candidate SHA and deployed identity. A definition of done cannot substitute a page, a test count or a prose assertion for a completed job.

For a visible workflow, start at the real navigation entry, reach the intended outcome at desktop and 390px, inspect the console, exercise keyboard use, and inspect the resulting stored/exported data. Apply screen-reader, public-artifact, print and other requirements to the actual job. Prove each changed consequential guard with a surviving harmless mutation and targeted failures. Record unknowns and unsupported states instead of forcing a success.

For data, retain exact geometry, CRS/axis order, units, time/cost basis, identifiers, source vintage, license, completeness, transformations and claim limits. For an approval, bind the responsible human to the exact version/payload. For operations, exercise interruption, recovery and the relevant migration/restore path. Human professional usefulness requires direct observation, separately from agent regression testing.

Use existing local computers and free resources. Measure compute time, peak RAM, disk growth, bandwidth and external-service use in milestone evidence. Any proposed paid dependency returns to Nathaniel before provisioning. No model run or inaccessible human study is described as completed because time or credits ran out.

## M0. Trustworthy candidate, review and documentation

- **Planning outcome:** a planner or contributor can tell what is released, what can be relied on, and where the next work is recorded.
- **Gap/evidence:** review R7-R9/R12; version 0.44 metadata preceded its tag; CI and the production dependency audit failed; old browser-success wording outlived stronger checks and later defects; current instructions split authority between two entry files and a manual.
- **Dependencies/scope:** wait for the active session's safe handoff. Inventory its final commits and acceptance attempts. Make repository AGENTS.md canonical, CLAUDE.md a pointer, and the old manual a compatibility link. Keep global configuration untouched. Consolidate current documentation while retaining dated studies/releases/decisions.
- **Done:** one current roadmap, capability ledger, architecture description, setup/operations route and known-limit register. Evidence-guard maintenance refuses missing browser captures and unsupported proven-cell promotion. Current candidate gets a clear released or not-released disposition with reasons.
- **Verification:** two preserved independent reviews; bad-record/no-op mutations; relevant tests/lint/type checks; docs command/link checks; final main and CI results named separately. Do not re-run or relabel a dated study to repair metadata.
- **Risks/questions/cost:** coordination with active fixes; stale source citations; isolated disk/test work only. No new hosted spend. Review the xmldom lockfile update and confirm a functioning private vulnerability-report path; current repository settings are not proof of dependable release review. A failed candidate remains failed until its actual blocker is corrected.

## M1. Correct plan geography, authority and legal applicability

- **Planning outcome:** a consultant can prepare a plan for a client outside the workspace's home state, and the responsible authority gets the correct plan-type checklist.
- **Gap/evidence:** R1/R2, land-use create route and descriptor registry. General and specific plans currently share rules; a workspace location gates an independent plan.
- **Dependencies/scope:** M0. Extend existing PlaceOfRecord, land-use versioning and jurisdiction registries. Distinguish exact study geometry, geography identity, responsible bodies, legal applicability and effective rule version. Preserve neutral/unresolved cases. Specify general/specific/amendment rules from authoritative sources.
- **Done:** correct California general and specific plans in a cross-client workspace; non-California neutral workflow; multiple/sovereign authorities without inferred state law; saved and exported context agrees. Agency process choices are distinguishable from statutory obligations.
- **Verification:** CA plan in OR workspace, OR plan in CA workspace, missing home, uploaded boundary, multistate MPO and tribal authority; independently mutate ownership and plan-kind selection. Inspect stored records, public artifacts and applicability decisions. Practitioner/counsel review the claimed legal scope.
- **Risks/questions/cost:** erroneous legal certainty, historical plan rules changing under adopted versions, incomplete local overlays. Requires source research and qualified review time; no paid runtime required. Nathaniel chooses representative cases, not schema design.

## M2. A complete planning case and recipient handoff

- **Planning outcome:** another authorized planner takes a case from intake to review, requests a change, approves the exact final record, reuses the outputs and carries named actions into implementation.
- **Gap/evidence:** R6/R10/R11; existing project/plan/report/evidence/My Work foundations, unresolved cross-module context and external reuse.
- **Dependencies/scope:** M1; M3 lifecycle/recovery controls appropriate to the case; M5 selected data handoff. Use existing Projects, Plans/Land Use Plans/RTP, Documents, Engagement, Reports and My Work. Define one authoritative owner per fact and link it through the case.
- **Done:** intake, source reuse, alternatives, consultation, public/technical review, exact approval, public derivative, implementation owner/date/status and later amendment remain traceable without repeated entry. Second organization receives a meaningful GeoPackage/workbook/document package.
- **Verification:** analyst/manager/approver/viewer/public roles; cross-workspace recipient; edit after approval; revoked access; stale source; lost network; return/resubmit; map/table/document counts and hashes. A real planner and recipient complete the case without Nathaniel guiding clicks.
- **Risks/questions/cost:** a polished generic checklist can hide absent domain analysis; project and three plan concepts can duplicate ownership. Use an actual representative record with permission. Human observation and local compute are the main costs.

## M3. Free, private and recoverable agency operation

- **Planning outcome:** an agency can run OpenPlan and recover its work without the founder, a paid entitlement or the original computer.
- **Gap/evidence:** R3-R5/R8/R13; Docker Desktop/Vercel assurances, CLI-versus-production Supabase boundary, external map extent requests, stage reaping, unchecked worker writes and partial recovery drills.
- **Dependencies/scope:** M0. Extend Node hosting, official self-hosted Supabase, existing worker services and scheduling. Establish a free Linux agency reference with browser clients; document Windows/macOS access separately from unproved native setup. Extend cartography with an open/local-capable provider path, using established libraries and licensed data. Add attempt-bound work ownership, checked writes and recoverable liveness states. Move long GTFS ingestion out of its current 300-second request while preserving existing version/adoption and input custody.
- **Done:** install, authenticated teammate use, meaningful maps, scheduled jobs, both demand workers, restart/cancel, full authoritative-record backup, restore to separate storage/host, upgrade and recovery all work. Outbound services are explicit and controllable. A no-egress profile produces useful maps/artifacts instead of blank screens.
- **Verification:** clean-machine commissioning; healthy computation beyond 45 minutes; process/database/network failure; duplicate/late workers; exact storage and local model-byte recovery; nonempty migrations; denied external traffic; correct final deployed identity. Run every worker family, not import-only substitutes.
- **Risks/questions/cost:** storage grows with models/imagery, tiles have license and update obligations, physical-disk failure defeats same-disk backups, authentication/email and public exposure need operational ownership. Measure resources and recovery objectives. Spending on hardware or a service requires Nathaniel; free software alone does not promise zero operating effort.

## M4. Agency confidentiality, records and responsibility

- **Planning outcome:** staff and outside consultants collaborate on sensitive work, publish an approved derivative and answer a records request without losing the authoritative originals.
- **Gap/evidence:** R10; workspace roles and public filtering exist, but finer confidentiality, tribal data controls, retention and legal-hold journeys are unproven.
- **Dependencies/scope:** M1/M2/M3. Define case membership and records responsibilities from observed needs before broad permission redesign. Extend current RLS, role matrix, exact approvals, documents and audit controls. Include staff departure, delegated responsibility and public-link revocation.
- **Done:** confidential originals, internal analysis, review copies and public artifacts have explicit access and retention rules; records requests and holds are traceable; backups and exports obey the same boundaries.
- **Verification:** live cross-tenant and same-workspace role/case probes, token revocation, attachment/export access, service-role routes, public leakage tests, restore-preserved permissions and named human review. Observe a records officer and tribal/agency data steward.
- **Risks/questions/cost:** conflicting public-record, confidentiality and sovereignty obligations cannot be decided by software defaults. Nathaniel/participating authorities supply policy choices; implementation and threat modeling remain engineering work. No new paid identity service is assumed.

## M5. Reusable data, GIS and defensible ordinary analysis

- **Planning outcome:** a planner imports agency data, understands its limits, analyzes it and sends a complete reusable result to another analyst.
- **Gap/evidence:** R6 and the active crash-cap defect. Existing importers, CRS registry, workbook review, GeoPackage builders and source provenance provide the starting point.
- **Dependencies/scope:** M0; align context with M1. Connect model/designation export layers already supported by the builder. Share selected-evidence assembly between direct and governed exports. Keep create-only workbook semantics until safe ID-based reconciliation is specified. Define source completeness and analysis score meaning before using derived totals.
- **Done:** every selected layer/row is exported or explicitly excluded; compatible reimport retains agreed fields; updates show a reviewed diff; unsupported/partial data cannot become total/zero/score. Source changes reopen dependent conclusions while frozen artifacts remain immutable.
- **Verification:** QGIS and independent spreadsheet reuse; malformed/truncated/large files; geometry collections and non-California CRS; units/price-year changes; unavailable/stale/partial sources; duplicate labels/IDs; layer version changes; exactly one changed source invalidates the right dependent claims.
- **Risks/questions/cost:** source providers change schemas and cap responses; huge input parsing can exhaust local RAM; formula and document input need safe handling. Measure file-size limits and worker thresholds. Do not build another GIS engine.

## M6. Multimodal and safety planning through an investment decision

- **Planning outcome:** a transit, walking/cycling, freight or safety proposal is compared with alternatives and becomes a justified project/program decision.
- **Gap/evidence:** capability matrix and R11; GTFS/accessibility/freight/safety foundations exist, but completed use-specific multimodal journeys and all-state injury coverage do not.
- **Dependencies/scope:** M2/M5 and applicable S-program evidence. Extend existing GTFS, Safety, Models, Projects and Programs. Treat schedule/service calendars, pedestrian/bicycle connectivity, freight movement and crash exposure as distinct inputs. Acquire serious-injury sources for every claimed KSI use; disclose fatal-only evidence explicitly during interim releases.
- **Done:** each modal job has an understood baseline, alternatives, costs, distributional/accessibility effects, source coverage and decision artifact. No travel-mode absence is inferred from disabled model inputs. No crash rate uses an incompatible modeled exposure denominator.
- **Verification:** service-day/calendar exceptions, transfer/walk access, missing injury data, unmatched road coverage, vehicle/person and period units, rural/no-feed cases, freight through-movements, external recipient review and relevant scientific use gate.
- **Risks/questions/cost:** data rights, feed maintenance, model transferability and sparse observations. Data-source work and local routing compute are required. Use established GTFS/GIS/routing tools rather than a replacement transit stack.

## M7. Land-use, housing and development review in practice

- **Planning outcome:** planners prepare and amend land-use/housing plans, then apply adopted policy to a development case and track its conditions.
- **Gap/evidence:** R1/R2 and unassessed development-review cells; existing versioned plans, designations, implementation actions and projects do not yet prove complete housing or entitlement work.
- **Dependencies/scope:** M1/M2/M4/M5. Extend plan/project homes for parcel/site inventory, capacity assumptions, policy/designation relationship, application completeness, interdepartmental requests, findings, conditions, appeals and compliance. California gets deeper source/rule/artifact proof; other jurisdictions use their actual requirements.
- **Done:** an adopted policy remains identifiable as its effective version when used in a case; a housing/site inventory preserves source vintage and defensible capacity assumptions; amendment and condition changes retain review history and implementation responsibility.
- **Verification:** real permitted records, general/specific/amendment distinctions, parcel splits/source updates, conflicting overlays, incomplete submissions, multiple authorities, public artifacts, changed effective dates and downstream conditions. Practitioner review must distinguish legal requirements from agency choices.
- **Risks/questions/cost:** parcel licenses and personal data, local rule diversity, specialized housing evidence and case deadlines. A new module needs a documented failure of existing ownership, not just a new name. Domain research time is substantial and remains pre-v1 work.

## M8. Regional, environmental, climate, resilience and equity decisions

- **Planning outcome:** regional and local planners compare alternatives, disclose distributional/environmental effects and carry adopted commitments into programs and monitoring.
- **Gap/evidence:** RTP and plan/project/report templates exist; the environmental/climate/resilience/equity capability remains unassessed. Template presence is not a statutory workflow or valid impact model.
- **Dependencies/scope:** M1/M2/M4/M5, applicable M6/S validation and authoritative rules. Extend RTP, Plans, Projects, Scenarios and Reports for environmental alternatives, consultation, mitigation/monitoring commitments, climate/hazard baselines, adaptation measures, equity assumptions and fiscal consistency.
- **Done:** each claimed workflow produces an inspectable decision record with correct authorities, alternatives, cumulative/time horizon assumptions, public/technical review and monitored commitments. Borrowed coefficients or unavailable impacts cannot be narrated as measured effects.
- **Verification:** metropolitan/rural/state/tribal/regional cases, nonattainment or other applicable overlays, changed forecast horizon, missing hazard/source data, subgroup effects concealed by averages, scenario consistency and follow-through after adoption. Specialist review and use-specific validation are necessary.
- **Risks/questions/cost:** substantial research, uncertain forecasts and changing law/data. No invented statutory completeness or general-purpose AI environmental determination. Local batch analysis and expert review are costs to measure, not reasons to exclude the work.

## M9. Public participation that changes a decision

- **Planning outcome:** a resident can participate accessibly, understand receipt/moderation, see the agency's response and trace how input affected a decision.
- **Gap/evidence:** existing Engagement/public portals and false-receipt correction; agent completion does not establish representativeness, language access or public understanding.
- **Dependencies/scope:** M2/M4 and actual agency participation policies. Extend campaign, survey, moderation, comment-response and decision links; support non-map/low-bandwidth and assisted/offline intake with provenance. Keep personally identifying originals separate from approved public content.
- **Done:** every received contribution has truthful status and an accountable disposition; agency summaries distinguish participation counts from representative public opinion; translated and accessible versions retain meaning; commitments enter implementation work.
- **Verification:** real public participants including keyboard/screen-reader/mobile users, language review, spam/filtered/duplicate submissions, moderation/revocation, interrupted submission, public export privacy and exact decision linkage. Observe comprehension rather than asking only whether they liked the page.
- **Risks/questions/cost:** moderation staffing, translation quality, consent/retention and outreach equity. Nathaniel owns recruitment/outreach; no contact or message is sent by the agent without authorization. Human time remains necessary even with automated regression tests.

## M10. Funding and delivery from priority to closeout

- **Planning outcome:** an approved priority becomes a funded, delivered project with defensible amendments, reimbursement and final records.
- **Gap/evidence:** Programs/Grants/Invoicing and closeout primitives exist; complete authorization-to-obligation-to-delivery proof across agencies is still partial.
- **Dependencies/scope:** M2/M4/M5 and relevant planning analyses. Join existing opportunity, application, award, program, project, invoice and document records. Preserve price year, currency, match, eligibility, benefit-cost assumptions and funding restrictions. Keep money and submissions human-controlled.
- **Done:** a reviewer can trace each proposed or actual financial amount and scope change to its authorization and source; outstanding commitments, reimbursement and closeout agree; project implementation actions survive plan amendments.
- **Verification:** incompatible price years, changed scope/award terms, rejected invoices, partial reimbursement, duplicate claims, authorization denial, staff handoff and immutable approved artifacts. Use real permitted funder/agency examples and live permission probes.
- **Risks/questions/cost:** eligibility changes, audit/records obligations and sensitive financial documents. No automatic external application or spending. Source-maintenance and agency review time are ongoing operating costs.

## S1. Scientific custody and comparable measurement

- **Planning outcome:** a modeler can determine exactly what was compared, what is unsupported, and why no accuracy claim follows yet.
- **Gap/evidence:** v0.39-v0.44 reports, frozen nationwide preregistration and science appendix. v0.44 did not advance overall; base-period/use acceptance and ingestion/display integrity remain incomplete.
- **Dependencies/scope:** M3 for durable execution. Preserve every existing frozen byte, consumed partition and negative result. Verify production custody ingestion, SQL omitted/NULL-field behavior, displayed-versus-downloaded hash/summary consistency and explicit loader errors. Align year/day/direction/lane/vehicle units, model quantities and source-supported observation intervals.
- **Done:** identical observation/network/input boundaries bind both separate methods, every loaded/unloaded/unmatched/unsupported observation remains accountable, and actual UI/report/assistant/evidence handoffs resolve exact records without invented zero or silent missing cards. Independent acceptance evaluator scope is specified; the current always-inconclusive diagnostic evaluator is not misrepresented.
- **Verification:** isolated service-role RPC malformed metadata probes; removed/swapped artifact and summary mutations; exact consumer agreement; wrong source SHA; no output access before preregistered preparation; hash-preserving replay. Do not open new holdouts for a software integrity test.
- **Risks/questions/cost:** scarce decisive observations, old artifacts whose unknown facts cannot be reconstructed, ingestion not actually connected. Local storage and computation only; primary-source research is a prerequisite.

## S2. Correct and test model structure on development evidence

- **Planning outcome:** a modeler obtains better-supported demand, distribution, behavior, external travel and network loading for the intended use.
- **Gap/evidence:** negative gateway/work-loading studies, disconnected/unloaded coverage, unsupported non-work through travel, borrowed behavioral coefficients and limited modal/time-of-day representation.
- **Dependencies/scope:** S1. Design falsifiable development experiments from diagnosed causes. Investigate generation, distribution/destination/mode choice, external/through travel, connectors/restrictions, network completeness, road classes, time periods and transit. Use existing AequilibraE/ActivitySim/PopulationSim and source adapters; reassess established engines only against a measured need.
- **Done:** each candidate has preregistered development purpose, source/algorithm/settings custody, conservation and coverage evidence, separate method results and an explicit advance/retire decision. Retired candidates remain available. No diagnostic result silently changes production defaults or acquires a higher tier.
- **Verification:** development-only splits, held-fixed comparison inputs, uncertainty and stratum reporting, rerun/resume determinism, no model averaging, no cross-county rescue, no hidden demand drop or output-guided rematching. Coefficient applicability needs source/estimation/transfer evidence beyond a local population fit.
- **Risks/questions/cost:** scientific failure is a legitimate outcome; surveys/observations may be unavailable or costly. Use free/authorized data and days-long local runs when justified. Buying data or commissioning research needs Nathaniel's approval.

## S3. Untouched use-specific nationwide validation

- **Planning outcome:** an agency can rely on each model for a clearly named use in its geography, with defensible uncertainty and limits.
- **Gap/evidence:** no independent nationwide accuracy result; current frozen protocol blocks acceptance and rules-v5 remains diagnostic. The historical 43.3% selection metric is not nationwide truth.
- **Dependencies/scope:** S1/S2; source-supported decisive observations, real independent geographic partitions, implemented acceptance evaluator and a successor preregistration frozen before outcome access. Set gates from primary evidence for each claimed use, not from observed candidate performance. Cover all states/DC and required archetypes, with deeper California proof.
- **Done:** each separate demand method passes every applicable untouched state/archetype/use gate; insufficient evidence remains inconclusive and blocks that claim. A national aggregate cannot hide a local failure. Forecast/environmental uses require their own stronger evidence; observed screening validity cannot be relabeled.
- **Verification:** independent custody/access controls; pre-output matching/quality grades; raw and uncertainty-aware residuals at link/screenline/system/state/archetype levels; road/mode/time coverage; sensitivity and transfer limits; audited final consumer claims. Exposed holdouts are consumed and cannot be reused as independent acceptance.
- **Risks/questions/cost:** the program is open-ended and may require new observations. Failure can require a new scientifically independent dataset, not a relaxed threshold. Runtime, calendar and release count never reduce the scope.

## G1. Geographic and organization coverage grows with each job

- **Planning outcome:** every state/DC and required organization can complete the core planning jobs in substance, with California deeper across its full diversity.
- **Gap/evidence:** 99 current capability cells are partial/unassessed; sparse jurisdiction readiness has three exemplars. Flat dimension labels do not establish the interactions.
- **Dependencies/scope:** continuous across M1-M10/S1-S3. Maintain job-by-authority-by-geography evidence with source/adapter/rule versions, responsible maintainers, refresh dates and limitations. Explicitly include tribes, multi-state/overlapping regional agencies, state agencies, transit operators, consultants, nonprofits, public participants and low-capacity users.
- **Done:** every required cell and interaction has current outcome/artifact/permission/accessibility/operations evidence. Territory policy is explicit. California includes statewide, metro, suburban, rural, mountain, coastal, border and tribal cases; other states add contexts California cannot represent.
- **Verification:** remove a source/state/role or expire a rule and the relevant coverage reopens. Test boundary/identity adapters and actual user jobs. No literal jurisdiction default in core logic; maintained country registries may name jurisdictions explicitly.
- **Risks/questions/cost:** legal/data maintenance outlives initial implementation. Establish named maintainers and upstream provenance; no national median, UI dropdown or source availability replaces a completed job. This is not deferred cleanup after modeling.

## A1. Grounded agent control of proven work

- **Planning outcome:** a planner can ask an agent to inspect and propose work across the completed case while retaining control of every consequence.
- **Gap/evidence:** existing assistant/action registry/approval controls and ADR-004; protocol and implementation assumptions need fresh official verification when implementation begins.
- **Dependencies/scope:** underlying M-program workflows proven first. Extend the existing action registry through an MCP server, not a second bypass route. Preserve distinct agent authorship, exact executed-payload approvals, narrow scopes, refusals, source grounding and audit history. Keep the non-agent product complete.
- **Done:** authorized reads and reviewable proposals operate across proven workflows; adoption, publication, money, facts and claim tiers remain human-controlled; revocation and malicious document/tool content cannot bypass those controls.
- **Verification:** exact-payload substitution, stale approval, cross-tenant scope, replay, impersonation, prompt injection in retrieved documents, missing source and unsupported claim tests; full visible approval journey and non-agent replay.
- **Risks/questions/cost:** model availability/pricing, untrusted inputs and user overreliance. Cloud AI is optional and subject to explicit operator spending policy. No paid agent dependency becomes necessary to finish ordinary planning work.

## V1. Independent whole-product proof campaign

- **Planning outcome:** agencies, consultants, individual planners and the public can adopt OpenPlan as a trustworthy, maintainable planning system.
- **Dependencies/scope:** all required milestones and coverage interactions; no unresolved Blocker/High defect hidden in a dated closed list. One candidate commit binds required CI, worker, RLS, migration, restore, artifact, accessibility, user and scientific evidence.
- **Done:** every required core job works across the stated geographic/organization scope; both models pass their published uses; independent humans install/operate/recover and complete/reuse representative work; public artifacts are accessible and approved; governance, security reporting, licensing and source maintenance have owners.
- **Verification:** release evidence manifest rejects missing/skipped/expired/wrong-commit/failed checks; clean installs and upgrades from supported releases; full recovery on separate hardware/storage; actual user observation; independent adversarial reviews; all scientific custody and use gates; no harmless-mutation false kill.
- **Risks/questions/cost:** the final campaign will discover defects and reopen cells. Fix them and repeat the affected evidence; do not rename them polish. Publish measured operating costs and limits. Tag v1 only when the binding contract is true.

## Human observation and product decisions

Use the [human observation protocol](product/PLANNER_OBSERVATION_PROTOCOL.md) to prepare research tasks and accessible consent materials before recruitment. Nathaniel owns outreach. Observe an agency planner, a consultant serving multiple clients, a small/rural or tribal organization, an approver/records steward and public participants. Use their existing work with permission; include failed recovery and external artifact reuse. Agent journeys discover regressions but cannot establish usefulness, trust, language quality or representative participation.

Bring Nathaniel decisions about territory depth, representative first cases, confidentiality/public-record policies and meaningful planning outcomes. Do not ask him to choose libraries, schemas, queue mechanics or test frameworks. When observation changes priority, amend this single queue with evidence while preserving the full v1 destination and previous dated decisions.
