# Independent product-direction review

September 6, 2026. Reviewed repository commit `f563d40ca51f4efda88de19aeaa6e62475772a76`. This report remains bound to that commit even if the parent session subsequently repairs findings.

## Decision

Keep the complete v1 destination and the current broad sequence. Treat desktop maintenance as a bounded implementation checkpoint, not completed independent operation or an accepted demo. Reproduce and repair assignment and shared-engagement handoffs next, then deliver the first agency OWP preparation and prior-program intake using existing Programs, Projects, Documents and finance records. Expand those reproductions to include amendment/version identity and all affected evidence consumers. They are necessary preparatory work, not a replacement for full OWP administration.

Do not tag v0.44 on this evidence. The documented complete first-week run remains nine passes and three partial outcomes. No new independent nationwide model validation exists in the material reviewed. Neither desktop maintenance nor a passing agency preparation case closes that scientific obligation.

## Independence and evidence limits

I began with the supplied review packet and read AGENTS.md, the review protocol, contract, current roadmap, requirements ledger, capability matrix, architecture, workflow handoffs, final first-week record and selected source. I did not read or contact the other current independent reviewer. I consulted the memory registry only for standing OWP priority and non-interference preferences; current findings below come from this checkout.

Repository status was clean at opening and at the final read-only source check. I ran `npm run product:direction:check` from the application package. It exited 1 because the latest review predates substantive housekeeping changes. This is the expected reason to perform and preserve a new review, not grounds to change only a metadata date. The source hashes of all three desktop implementation files match the recorded proof-results.json. This establishes evidence identity, not the truth of every test claim.

No app/worker tests, browser sessions, live services, database queries, user observations, source research on the internet, releases, publications or process signals were performed. I inspected the recovery fixtures, rather than rerunning them. Remote CI and current served identity are unknown to this review and must be supplied separately. The local direction check failed; this report does not itself complete the protocol's final guard-mutation requirement.

“Source-established” below means the behavior follows from inspected code. “Documented” means a retained report says it happened. “Inference” is my engineering/product conclusion. “Unknown” names missing evidence. Legal details in dated OWP research are requirements-research inputs, not independently refreshed legal conclusions.

## Consequential findings

### F1. Assignment continuity is broader than missing dates

Source-established: `openplan/src/lib/my-work/sources.ts:728` defines plan implementation as a deadline source; its filter at line 740 excludes null `due_on` even when an assignee exists. The mapping always emits a due-date label. A planner can therefore assign an action that the default assigned-work source cannot return.

The same source selects actions across all plan versions without a version-state or current-version restriction and uses `dedupKey: null`. `openplan/src/app/api/land-use-plans/[planId]/versions/route.ts:72` copies action descriptions, assignees and dates without their status; lines 114-118 assign every copy `not_started`. Adoption supersedes the former version without deleting its actions, in `20260823000007_land_use_plan_review_reporting.sql:358`. The plan API instead opens the current working/adopted version, in `[planId]/route.ts:38`.

Inference: after an amendment, My Work can show both historic and newly copied work, can turn a completed action into a new assignment, and can send a historic task to a page displaying another version. That undermines the everyday promise more deeply than a missing deadline. Whether reopening a particular action is intended is a professional workflow decision; the software needs explicit continuity and version meaning rather than accidental reset semantics.

Next evidence: assigned undated, dated, completed, deferred, adopted and superseded cases; create an amendment; open each queue entry; verify the exact action/version and intended carry-forward decision. Preserve genuinely new work and legitimate continuing obligations. Do not simply hide every prior adopted action while its amendment is still a draft. Live occurrence and practitioner agreement remain unknown.

### F2. Shared engagement loses meaning across consumers

Source-established: the project page at `openplan/src/app/(app)/projects/[projectId]/page.tsx:540` correctly calls `loadEngagementCampaignsCoveringProject`, which includes the coverage join table. `openplan/src/lib/project-evidence-bundles/generated-records.ts:272` filters only `engagement_campaigns.project_id`. `openplan/src/lib/grants/narrative-evidence.ts:355` does the same. Plan and program assistant contexts at `openplan/src/lib/assistant/context.ts:2771` and `:3165` also filter only the lead project.

Inference: a non-lead project can visibly participate in a campaign yet lose its contributions from a governed export or grant grounding, while the assistant understates available engagement. An approval cannot make an incomplete selection complete.

Repair the shared definition of project coverage across these consumers, while preserving public/internal selection rules and workspace permissions. Do not blindly use the project-page loader's default six-campaign display limit for a complete export. A genuine coverage-read failure must not turn into a confident empty record.

Next evidence: one campaign shared by two projects, plus lead-only and unrelated campaigns; compare project UI, governed artifact contents, grant grounding and assistant counts; test duplicate membership, revoked access, failed coverage reads, more than six campaigns, moderation and export disclosure boundaries. No present live reproduction is claimed.

### F3. The updater still makes one stronger database claim than it can support

Source-established: `refresh-walkthrough-instance.sh` queries `supabase migration list --local`. Its CURRENT branch says every migration is applied to “the instance database.” The inspected code never establishes that the queried local stack is the database used by the web app's runtime configuration. The coordinator and final controller messages separately admit runtime database identity remains unverified.

Correct the specific shell message to describe the queried local stack. Later caveats should not have to undo an earlier affirmative claim. This wording repair is small and does not complete runtime database binding.

The updater still fast-forwards to `origin/main`, without an accepted-demo selector. The roadmap and maintenance record admit that boundary. Preserve it visibly and do not describe the update button as a way to obtain an accepted release. Before M3a completion, bind the intended accepted commit, required checks, actual runtime database and served build, then exercise a real representative Next/Supabase update and recovery under explicit ownership.

### F4. OWP readiness must include a financial baseline and source review

Source-established: `openplan/src/lib/programs/catalog.ts` offers capital-program types and “Other Program Lane,” while `programs/api.ts` loads cycle/funding/sponsor/date fields and linked project records. These are useful foundations, but they do not establish an OWP work-element, allocation-vintage, adopted-baseline or amendment workflow. The requirements ledger correctly keeps the complete outcome open.

Inference: adding an OWP dropdown and importing a PDF would make a discoverable starting point but would not finish preparation. The first useful result is a reviewed program draft whose work elements, people, products, funding and carried-forward obligations reconcile to its permitted predecessor and approval baseline. A finance reviewer must distinguish proposed resources from authorized resources before later delivery and claims rely on them.

The dated OWP research already identifies unresolved agreement terms, inconsistent guidance labels and unrendered workbook/formula questions. Resolve the specific source versions and agency authority used in the first case. Do not convert those research notes into automatic eligibility rules.

## The ten protocol answers

### 1. What would make this the ultimate free planning operating system?

One continuous, understandable agency record. A planner can begin with the adopted predecessor and real source records, decide what changes, assign work, receive public input, prepare the decision, obtain actual authority, deliver the work, reconcile funding and hand a usable record to a successor. The recipient should not need to know which module produced each fact. Adoption, task completion, a payment, a funder claim and model validation must retain their distinct meanings.

This is my product judgment, consistent with the contract. Existing versioned plans, project controls, shared documents, engagement, approvals and finance records make extension credible. Source inspection also shows that inconsistent joins and task/version semantics still break continuity. Full scope across all named practices remains necessary, including scientifically validated modeling and independent operation.

### 2. Can every type of US planner do core work here?

No such claim is supported. The matrix marks entire practices partial or not assessed. That does not establish every underlying function absent.

| Perspective | Assessment and necessary depth |
|---|---|
| Transportation and travel-model science | Partial foundations. Complete corridor, service, safety and investment decisions remain distinct from model execution or a map. The documented Safety and model-comparison first-week jobs remain partial. Transit, active modes, freight, period behavior and use-specific validation cannot be closed by one auto-volume case. |
| Land-use, statutory and development planning | Partial land-use foundation; development workflow not assessed. Plan-owned authority, complete applicable rules, amendments, implementation continuity and development findings/conditions remain necessary. Source confirms workspace home still controls configured legal descriptors. |
| Environmental, climate, resilience and equity | Full practice not assessed. Need actual alternatives, impact and distributional analysis, mitigation/monitoring, consultation and retained assumptions. Neither templates nor AI-written narrative establish analysis. |
| Engagement, Title VI and public decisions | Partial. Shared evidence omission is concrete. Better-than-Social-Pinpoint remains unproved and needs matched observed participant and agency tasks, accessible/language-appropriate participation, receipt, response, decision linkage and inspected portable exports. Title VI is broader than a moderation queue. |
| Capital, grants, delivery and reimbursement | Partial. Need planning-to-authorization-to-construction/closeout lineage, grant pursuit and post-award administration, recipient reporting, proper procurement methods and distinct source-cost/payment/claim records. A planning fee budget is not a capital financial plan. |
| Rural, tribal, small-agency and constrained-capacity use | Broad support not proved. Actual small-team roles, intermittent connection, low operating effort, sovereignty, confidentiality and multiple authorities need separate cases. Rural agencies must not inherit MPO-only assumptions, and tribal authority must not come from an enclosing county. |
| GIS, interoperability, custody and public records | Partial. Existing imports and export builders are real, but complete selected evidence, field/geometry/unit meaning, historical version identity, public derivatives and independent recipient reuse remain open. Source custody cannot substitute for usefulness of the file. |
| Agency operations, collaboration, accessibility, installation and recovery | Partial. Desktop process/file safeguards improved in the reviewed source. No complete real agency upgrade/restore or installed operator recovery was demonstrated by this checkpoint. Current browser/390px and practitioner evidence remain necessary for changed workflows. |
| Adversarial product strategy | The largest recurring gap is work surviving a change of person, fiscal year or adopted version with its meaning intact. That crosses the existing modules and deserves more attention than another capability counter or dashboard. |

### 3. Does every state work in substance?

No. The contract requires all 50 states and DC, while the capability matrix preserves missing state sources, legal depth and completed workflows. Correctly reporting unsupported geography is valuable interim behavior, but cannot pass this requirement. `land-use-plans/route.ts:75-95` derives descriptor permission from workspace home rather than the plan's actual authority. That prevents correct cross-client use even before national statutory completeness is considered.

Apply geography and authority cases within each early lane. Keep tribal, multistate, direct-award and overlapping authority distinct. Territories require explicit support and unresolved scope interpretation, as the roadmap records; do not weaken either contract or guard through an engineering shortcut.

### 4. Is California the gold standard?

No. Deeper California content is documented, but not complete agency/practice acceptance. The source still rejects a configured California legal bundle when workspace home recommends another descriptor. The initial applicable-requirement function receives the descriptor rather than the chosen plan kind. Correctness of general/specific-plan requirements therefore still needs the queued source/applicability work.

For OWP, test separate MPO and rural RTPA cases with their actual funding and approval records. For capital work, preserve specialist and outside-authority evidence through closeout. Include rural, mountain, urban, tribal, coastal and border settings where the claimed use varies. One county or one familiar office cannot establish California completeness.

### 5. Are both models validated for every published use and state?

No. The contract and retained final outcome record state that no independent nationwide accuracy result has been established. The distributed-loading candidate remains retired and inconclusive. The dated ActivitySim runtime record proves a particular run executed; it explicitly describes borrowed behavior and limitations. Its historical counts were not remeasured here.

AequilibraE and ActivitySim remain separate obligations and outputs. Match geography, population, network, settings and observed quantity; preserve observation uncertainty separately from acceptance tolerance. Development studies and consumed holdouts remain development history. No model agreement, national average or operational success can stand in for untouched acceptance in each state, archetype and published use. S1-S3 remains active alongside everyday work, with resumable long-running workers and durable custody.

### 6. Simplest overlooked idea with the largest effect?

Make every work item and handoff answer: which approved or draft obligation is this, who acts next, and what evidence proves the step happened? Carry that identity through amendment, fiscal carryover, review and export. An OWP work element can link existing projects, staff work and products without duplicating them.

This is an inference supported by the actual assignment-version and campaign-coverage inconsistencies. It is also already partly anticipated by M2/M11; the omission is consistent execution and proof, not a missing brand-new module. A new dashboard would merely summarize disconnected records unless these joins are correct.

### 7. Which old rule or decision is wrong?

Workspace home as the authority for a client's plan is wrong, as demonstrated by the creation route. “Assigned work” equated with “dated work,” and copying an action into an amendment as an implicit reset, are also inadequate default semantics. Runtime commit identity must not stand in for database readiness or accepted-demo status.

The old tendency to let numeric roadmap order dictate implementation is already superseded by the current dependency sequence. Keep that correction. I found no basis to restore no-new-modules as an absolute prohibition, to narrow v1, or to replace the chosen whole-product priorities with another long run of modeling releases. A new module still needs proof that existing homes cannot support the job coherently.

### 8. What should be removed, joined or deepened first?

Join campaign coverage, task/version continuity and approved-source identity across existing consumers. Deepen Programs for OWP with linked work elements and approval/budget baselines, and deepen M11 so delivery forecasts and financial records retain separate meanings. Reuse Documents/OCR and reviewed intake for both OWP and RTP predecessors; do not build independent imports with inconsistent provenance.

Remove misleading labels and redundant re-entry where a linked source record already exists. Preserve historical evidence, submitted records and original source bytes. Do not remove unsupported-state disclosures, historical scientific failures, or lawful underspend because they complicate a green completion indicator. No new module or rewrite is justified by this review.

### 9. What evidence would prove these recommendations wrong?

| Recommendation | Falsifying evidence or unresolved decision |
|---|---|
| Repair assignment continuity before relying on My Work | An identified-build journey shows undated assignments, completed-action amendments and superseded actions remain accurately actionable and version-specific through the production queries; explain the source filters and reset behavior. Practitioner evidence may establish some resets are intended, but must name them. |
| Unify shared-campaign coverage | Production artifacts and grounding demonstrably include non-lead campaigns through another scoped path, with complete counts and failed-read disclosure. The inspected lead-only paths would then need narrower documented semantics. |
| Extend existing Programs for OWP | A permitted, source-backed OWP preparation/quarter case shows existing program ownership fundamentally cannot represent multiple work elements, authorities and funding vintages without conflicting owners. That could justify another home after a whole-product review, not before trying a coherent design. |
| Keep OWP as the next substantial outcome | Current observed planners demonstrate another unmet outcome is a prerequisite that blocks the OWP case, or Nathaniel changes product priority. Engineering convenience and a tempting code seam are not falsifiers. |
| Keep desktop maintenance partial | A target-bound real update, failure, interruption and recovery exercise proves actual database identity, correct accepted-build selection, restored bytes and useful operator continuation on the installed control. Disposable HTTP fixtures alone cannot do this. |
| Keep nationwide science unvalidated | Auditable preregistration and independent untouched acceptance for each required state/archetype/use, for each engine, with reproducible records. Another successful run or better development residual is insufficient. |

### 10. Highest-leverage next completed outcome?

An agency planner and finance reviewer prepare a source-linked OWP draft from the adopted predecessor, reconcile work elements/products/staff/consultants/funding and carried-forward obligations, and hand it to an authorized reviewer without reconstructing the record manually. It must be discoverable, survive interruption, and produce an inspectable draft and structured reconciliation. Preparation completion must not claim adoption or outside authorization.

First repair the proven handoff seams and include the lifecycle cases above. Then complete M2d.1 with the minimum necessary M1/M3/M4/M5/M11 foundations. Continue to one actual quarterly reporting/returned-claim cycle, amendment and carryover/closeout under M2d.2-4. These later outcomes remain explicit obligations, not optional future polish.

Retain M9 engagement, A0 provider choice with A1 integrity, M10 capital, M11 finance, M12 prior-RTP intake and M13/M14 administration/procurement as the next coordinated priorities. Do not launch all of them as simultaneous unfinished forms. Each increment should finish a useful job and preserve the complete queue. Scientific custody and nationwide validation continue as a separate program throughout.

## Handoff to synthesis

Preserve this independent report unchanged. Reconcile its findings against the other review and current source before editing the canonical record. Record any disagreement and the synthesizer's judgment. Correct F3 wording without claiming runtime binding. Carry F1 amendment/version cases and F2 consumer breadth into the next reproduction scope. Supply exact remote CI and served identity separately. Complete the direction guard's bad-record and harmless-control proof after incorporating the independent reviews; do not call this report alone a passing direction gate.
