Independent strategic review B, October 6, 2026

OpenPlan should next complete an engagement case that carries retained public input through staff interpretation, reviewed responses, a project decision and usable files. The immediate staff-generation controls fit that outcome, provided they connect the existing implementation instead of starting another execution system. Scientific evidence preparation, geographic authority and independent operation must continue alongside this work.

I reviewed the clean integration checkout at `380aad49770d856a9c4b577ccc9793baf39d3ddf`, the supplied direction packet, current product authorities, selected implementation paths and dated evidence. This was a read-only review. I ran no tests, browser journeys, database operations or external-service checks. I did not read another new reviewer's conclusions. Existing verification reports are evidence of their named checkpoints, not fresh runtime acceptance.

1. What would make OpenPlan the ultimate free planning operating system?

A planner should be able to carry one accountable planning case from the original need through evidence, alternatives, public input, authorization, delivery and continuing obligations. Another authorized person should understand the case and continue it without reconstructing its history.

That requires shared records with clear meanings. A source document, adopted policy, consultant fee, project expenditure, funding claim and public response are related facts, but they are not interchangeable. The contract already states this distinction. The architecture identifies Projects and statutory plans as the durable context owners and describes disconnected translations between some existing workflows. The highest product value comes from closing those handoffs.

Free independent operation is part of that outcome. An agency must install, maintain, export and recover its records without Nathaniel or a required commercial provider. Optional agents should reduce preparation work while leaving manual workflows complete. Their output cannot confer adoption, spending or scientific authority.

Sources: `docs/product/V1_PRODUCT_CONTRACT.md`, especially “One coherent operating system” and “Permanent boundaries”; `docs/ARCHITECTURE.md:41–63`; `docs/ROADMAP.md:152–236`.

2. Can every type of US planner perform their core work here?

No complete-product claim is supported. I independently counted the current capability registry. It contains 37 partial and 62 not-assessed entries, with zero proven entries. Those entries describe dimensions, not a count of complete jobs or all their interactions.

The following jobs remain shallow or unproved at the required outcome level:

| Practice | Outcome still requiring completion evidence |
|---|---|
| Transportation and regional planning | Complete predecessor-to-successor RTP update, consistent policies and financial tables, multimodal alternatives, partner review and implementation. |
| Land-use and development planning | Correct plan-owned authority, housing and parcel evidence, development intake, findings, conditions, departmental review and subsequent compliance. |
| Environmental, climate and resilience planning | Applicable alternatives and consultation, defensible analysis, cumulative and future conditions, mitigation responsibilities and continuing monitoring. |
| Transit, active transportation, freight and safety | Mode-specific service or investment decisions, valid exposure and service calendars, and traceable treatment, resource and implementation assumptions. |
| Agency program and financial administration | Complete OWP/UPWP administration, contract forecasts, capital delivery, recipient reporting, reconciled payments and source-specific submission packages. |
| Procurement | Consultant pursuit and agency solicitation through protected receipt, evaluation, award and executed-contract handoff. |
| Community and nonprofit planning | Accessible participation, permitted evidence access, understandable public decisions and durable handoff without specialist support. |
| Tribal, rural and small-agency practice | Sovereign authority, data stewardship, limited connectivity, proportionate administration and independent operation. |
| GIS, aerial and records work | Reusable complete exports, independently usable archives, full aerial processing and measurement boundaries, records requests, retention and holds. |

These are not findings that all underlying functionality is absent. The repository contains substantial foundations and bounded completed increments. For example, OWP preparation, amendment handling and several reporting/closeout operations have dated engineering evidence. The remaining question is whether the complete practitioner case works.

A potentially overlooked cross-cutting job is managing what changes after a decision. A revised source, permit condition, funding rule or design assumption should expose the affected work and responsible person. Architecture proposals already mention this need, but the operational outcome deserves explicit acceptance across planning, environmental and delivery cases.

Sources: `docs/product/US_PLANNING_CAPABILITY_REGISTRY.json`; `docs/product/US_PLANNING_CAPABILITY_MATRIX.md:64–131`; `docs/product/CORE_REQUIREMENTS_LEDGER.md`, “Named practice and organization cases”; `docs/ARCHITECTURE.md:152–179`.

3. Does every state work in substance?

No. The current matrix records California as partial and the other states and DC as not assessed against the complete contract. The readiness registry's California, Oregon and Puerto Rico examples disclose limits. They do not establish substantive national coverage.

I confirmed a consequential current counterexample in code. The land-use creation route reads workspace home geography, recommends a descriptor from that geography and rejects a configured descriptor that differs. A consultant's office location therefore still constrains a client's legal workflow. This is incompatible with plan-owned authority and overlapping or sovereign jurisdictions.

G1 should accompany each completed job. Each case needs a maintained source and applicability record tied to its actual authority, funding, period and jurisdiction. State labels and neutral fallbacks are useful interim behavior. They do not satisfy the required state outcomes.

Preserve all 50 states and DC, explicit territory assessment, tribal sovereignty and overlapping authorities. The documented territory-depth disagreement remains unresolved. This review does not remove territory cells or weaken their gate.

Sources: `openplan/src/app/api/land-use-plans/route.ts:75–99`; `openplan/src/lib/jurisdiction-readiness/registry.v1.json`; `docs/product/US_PLANNING_CAPABILITY_MATRIX.md:111–131`; `docs/ROADMAP.md:648–664`.

4. Is California the deepest complete implementation?

California is the intended deepest implementation, but completeness is unproved.

The current land-use authority defect alone prevents that conclusion. Capital administration also requires more than a complete reading of the Local Assistance Procedures Manual. Actual funding authority, applicable versions, signed documents, field quantities, payments, reimbursement and continuing maintenance must connect through the same case.

The OWP work supplies reusable evidence and implementation. It should not be restarted. Extend it through a complete applicable cycle, with its unresolved balances, submission compatibility and external authority visible. California proof must cover the stated statewide, metropolitan, suburban, rural, mountain, coastal, border and tribal contexts. One regional agency case cannot stand in for those differences.

I did not refresh legal sources in this review. The September research establishes a source inventory and dated interpretations. Current controlling requirements must be verified when an implementation relies on them.

Sources: `docs/product/V1_PRODUCT_CONTRACT.md`, “California gold standard”; `docs/ROADMAP.md:175–209` and `440–496`; `docs/ops/KNOWN_ISSUES.md`, KL-2026-09-04-001 and KL-2026-09-04-059; `docs/reviews/2026-09-04-pre-handoff/LAPM_FEATURE_GAP_ANALYSIS.md`.

5. Are both travel models independently validated for every published use?

No.

The current nationwide preregistration remains `frozen-blocking`. Its acceptance outcome is `inconclusive`. It explicitly lacks the completed decisive datasets, hashes, observation intervals, independent geographic partitions and use-specific thresholds needed for acceptance. The status document also distinguishes the diagnostic instrument from an implemented acceptance evaluator.

Execution of AequilibraE and ActivitySim is established historically. Independent nationwide accuracy is not. The historical 43.3 percent median absolute percentage error is consumed one-county selection evidence. It cannot support a national claim.

The dated ActivitySim execution record documents a stock MTC path with borrowed behavior, period-invariant auto skims and disabled transit representation. The current status document cautions that later native evidence includes transit. Therefore, I would not generalize the old path's zero transit skims to every current execution. Neither record establishes accepted transit accuracy.

The next scientific outcome should be an auditable observation and validation design ready for independent acceptance, followed by structural development experiments. Preserve untouched acceptance data. Keep observation uncertainty separate from the tolerance justified for the intended use. Assess both models separately by state and required archetype; model agreement cannot rescue shared error.

Sources: `docs/modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json`; `docs/modeling/STATUS_AND_VALIDATION.md`; `docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md`; `docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md`.

6. What simple overlooked idea has the largest product effect?

Make the next required action and its reason visible in the existing case and My Work.

For each unresolved obligation, staff should see the responsible person, due or decision date, controlling source/version, current blocker and direct action. Examples include a returned reimbursement request, a changed source cited by an approved report, an unanswered contribution, an environmental commitment and a deliverable awaiting acceptance.

Much of this intent already exists in M2c and the requirements ledger. The overlooked opportunity is to use it as a shared acceptance condition across modules. A planner should not need to inspect every module to discover consequential unfinished work.

Start with the selected engagement case and reuse existing assignment, issue, review and decision records. Avoid a new dashboard or generalized workflow engine until actual cases establish the need. Failed reads must remain visible; they cannot produce an apparently empty work queue.

Sources: `docs/ROADMAP.md`, M2c; `docs/product/CORE_REQUIREMENTS_LEDGER.md:53–72`; `docs/ARCHITECTURE.md:154–179`.

7. Which old rule, decision or roadmap item is now wrong?

Several current summaries need reconciliation.

First, treating September's pending engagement links and files as wholly unfinished is wrong. The v0.64 release record documents approved synthesis links to responses and project decisions, private review files, corrections and preserved earlier downloads. Current code also contains the thematic import panel. The remaining work is the coherent staff-generation path and whole-case proof, not rebuilding those existing components.

Second, reading October's numbered sequence as postponing M1, operations and science until after every M2d/M10–M14 increment would be wrong. G1 explicitly runs throughout the milestones, and the roadmap says scientific custody continues alongside ordinary planning work. The October sequence should say so directly.

Third, architecture text still describes some implemented work as proposals and depicts optional AI as Anthropic-only. Historical descriptions should remain dated, but a current implementation summary should point to the newer evidence.

Fourth, a demand for practitioner or finance sign-off before engineering release would contradict the September 9 release policy. Human usefulness remains an unmeasured outcome where unobserved. It is not permission to stop verified development work.

Finally, W1 cannot independently authorize new Nat Ford marketing. The current user instructions place that consultancy on indefinite pause and require asking before new marketing. Retain the historical adoption requirement without acting on it under general OpenPlan development authorization.

Sources: `docs/reviews/2026-09-27-synthesis-response-links/RELEASE_VERIFICATION.md`; `openplan/src/components/engagement/synthesis-review-editor.tsx:228–232`; `docs/ROADMAP.md:37–76`, `648–664`, and W1; `docs/ARCHITECTURE.md:25–35`; `docs/product/DEVELOPMENT_RELEASE_POLICY.md:47–71`; current user-provided AGENTS instructions.

8. What should be removed, joined or deepened before adding anything new?

Join retained source selection, request creation, preparation, cancellation, provider authorization, retained outputs and proposal import into the existing campaign workflow. Continue through the existing staff approval, response and decision records.

Deepen the shared financial and authority records across OWP, M11 contracts, M10 capital delivery, M13 recipient reporting and M14 procurement. Preserve the distinction between cost, fee, cash, eligible expenditure, claim and settlement. Avoid a separate financial ledger inside each workflow.

Join prior-RTP intake to actual chapter, table, policy, project and financial reuse. The known ordinary-launcher chapter-extraction gap is a concrete candidate for M12a, subject to fresh implementation verification.

Remove stale present-tense completion statements and duplicate sequencing instructions from current summaries. Preserve historical reports unchanged. Do not remove schema or functionality merely because its name sounds commercial.

No new top-level module is justified by the evidence I reviewed. Complete development review, environmental commitments or procurement may eventually require a clearer user-facing home, but establish that need through the corresponding case.

Sources: `openplan/src/components/engagement/engagement-synthesis-sources.tsx:184`; `docs/reviews/2026-10-06-integration/INTEGRATION.md`; `docs/ARCHITECTURE.md:111–127`; `docs/ops/KNOWN_ISSUES.md`, KL-2026-09-04-028 through 032.

9. What would prove these recommendations wrong?

| Recommendation | Falsifying evidence |
|---|---|
| Complete engagement next | A current identified-build case already completes creation through decision and files from ordinary navigation, or a reproduced access/data-loss defect makes another prerequisite immediately necessary. |
| Add shared next-action visibility | Staff using the existing views reliably find and resolve consequential exceptions without duplicate entry or missed responsibilities. |
| Correct plan-owned authority early | A current authoritative implementation and observed cross-state consultant/tribal case demonstrate that workspace home no longer controls the legal descriptor. The inspected route currently contradicts this. |
| Deepen existing homes | Repeated permitted cases demonstrate that existing ownership forces conflicting facts, duplicate histories or unusable navigation that a bounded new home resolves. |
| Continue scientific preparation alongside other work | Adequate, independently custodied datasets and an implemented evaluator already satisfy the frozen acceptance design. Their exact artifacts would need to supersede the current blocking record. |
| Reconcile current status documents | A clear current index already lets an unfamiliar contributor distinguish superseded gaps, completed increments and remaining outcomes without reconstructing several historical appendices. |

The outcome evidence must identify the candidate, input, authority, person or role, artifact and recipient. Automated controls should reject a relevant broken behavior while allowing a harmless change. Browser automation, file checks and human usefulness remain different evidence.

10. What is the highest-value next completed outcome from the v1 perspective?

A planner completes one engagement decision case from retained input to an accountable project decision, then another authorized person can reconstruct it from the application and delivered files.

The next bounded implementation should let staff create a request from a retained source, preserve the original intent, prepare it, understand cancellation and recovery, explicitly authorize the chosen provider, inspect retained output and import a proposal into the existing review. Root, context and thematic stages must preserve their actual relationships. Lost replies must recover the same request and must not silently create another provider call.

The completed case then uses the existing v0.64 response/decision links and exports. It should preserve disagreement, unaddressed concerns, participation limitations and public/internal distinctions. Manual preparation remains available. Generated themes do not establish representative support or an agency commitment.

Accept the engineering increment through identified desktop and 390px navigation, access changes, unavailable storage, stopped workers, uncertain dispatch, correction history, usable PDF/XLSX/open-data files and recipient reconstruction. Report the limits honestly. Comparative superiority, language quality and professional usefulness remain unproved until observed; they do not block verified development releases.

After that case, the next agency outcome should connect actual OWP work, contract delivery, source costs and a prescribed reporting/reimbursement period through correction and settlement or explicitly unresolved settlement. This uses the existing M2d/M11 foundation and exposes real needs shared with capital administration, recipient reporting and procurement. Preserve the full prior-RTP and procurement outcomes as explicit work, rather than absorbing them into a generic capital case.

Throughout both outcomes, keep a separately tracked scientific evidence task and geography/authority task active. The complete v1 destination remains all required planning practices across 50 states and DC, explicit territories and sovereign/overlapping authorities, California depth, independent free operation, and separately validated AequilibraE and ActivitySim for every published use. This recommendation changes sequencing and integration, not that destination.

Sources: `docs/ROADMAP.md:37–76`, M2d, M9, M10–M14 and S1–S3; `docs/reviews/2026-10-06-integration/INTEGRATION.md`; `docs/reviews/2026-09-27-synthesis-response-links/RELEASE_VERIFICATION.md`; `docs/product/V1_PRODUCT_CONTRACT.md`.

<oai-mem-citation>
<citation_entries>
MEMORY.md:37-44|note=[read-only review custody and current direction lookup]
</citation_entries>
<rollout_ids>
01a0fa90-4199-7362-9129-e5c6d5bd1df8
01a0fa98-4d4b-7b33-be6b-953ad1d59386
</rollout_ids>
</oai-mem-citation>