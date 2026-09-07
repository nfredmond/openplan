# Independent OWP review A, September 7, 2026

M2d.2 belongs in the existing Programs workflow. The current implementation has two source-established defects that prevent acceptance. Keep v0.44 unreleased. This report does not certify an agency decision, legal applicability, spending eligibility or completed M2d.2 acceptance.

## Identity and limits

I began with `/tmp/owp-review-direction-packet.md` and independently inspected checkout `/home/nathaniel/.local/state/openplan/owp-review-2026-09-07`, branch `work/owp-review`, HEAD `3004393820ec6f2b05f7a00136bf887914da48b4`, including its uncommitted workflow implementation. I read AGENTS.md, the review protocol, packet contract/roadmap/capability matrix, architecture, known issues, existing preparation verification and dated ActivitySim runtime evidence. I used the unslop and prove-it skills. A bounded memory lookup located prior sequencing and evidence boundaries; current sources control this assessment. I did not read reviewer B's report or contact that reviewer.

`npm run product:direction:check` failed because the latest direction review predates the current substantive OWP edits. This is an observed failure, not permission to change the recorded date without review. GitHub read-only inspection showed completed successful CI, Upgrade Path and RLS Isolation workflows for HEAD, respectively runs 34162478363, 34162478338 and 34162478360. Those runs concern the committed predecessor, not these uncommitted changes. The latest locally present release tag is v0.43.0. Package v0.44.0 is a development candidate.

No services, database writes, browser actions, source mutations or test changes were performed. I did not execute the live suite or inspect generated M2d.2 files. Source findings below identify deterministic control-flow conflicts; they are not claims that a live agency case reproduced them. Existing preparation verification is documentary evidence with its stated scope and prior failures. Its EDCTC exercise cannot establish actual adoption or outside authority. Other active node/Codex processes were present and left alone.

## Actionable findings

### A1. High: an amendment draft blocks authority evidence for the effective baseline

In `openplan/supabase/migrations/20260909000001_work_program_review.sql:76`, external acceptance and spending authorization require the selected revision to be the latest revision. Lines 108-109 separately require that revision to be the effective adopted revision. Starting an amendment creates a later preparation revision while preserving the adopted baseline at lines 113-135.

The resulting valid agency situation is impossible to record. Adopt revision 1, start revision 2 as a pending amendment, then receive external acceptance of revision 1. Revision 1 fails the latest check; revision 2 fails the effective-baseline check. The same conflict applies to spending authorization evidence. A saved draft must not block recording a decision about the version that still governs the work.

Exempt these two evidence kinds from the latest-only restriction while retaining current sequence, content hash and effective-revision checks. Add a positive case for effective revision 1 after revision 2 exists and a negative case for authorizing unadopted revision 2. The existing live test checks the second case but misses the first. This finding was sent immediately to the implementing agent.

### A2. High: public disclosure acknowledgement survives a change of content

In `openplan/src/components/programs/work-program/workflow.tsx:17`, `publicReviewed` is independent state. The revision selector at line 65 changes `selected`, but does not invalidate that acknowledgement. Only changing audience at line 86 clears it. The packet component at line 88 remounts for a new revision or history sequence while receiving the old true value.

An administrator can acknowledge revision 1, select revision 2, and prepare its public copy without reviewing the new content. Reloaded or newly recorded history has the same problem. The database checks the supplied boolean and administrator role at `20260909000002_work_program_review_packets.sql:39-40`; it cannot detect this inherited checkbox state. Public copies contain the full selected preparation content and baseline differences, so the consequences exceed disclosure of review notes alone.

Bind the acknowledgement to the selected revision ID/hash, history sequence and audience, or invalidate it on every identity change. Exercise revision switching and history refresh in the UI, then inspect actual public HTML/PDF/XLSX for private sentinel values. These copies remain in private Documents until someone shares them; this is a public-copy approval defect, not evidence of an anonymous online leak. This finding was sent immediately to the implementing agent.

## Additional boundaries to establish

- Authority is entered as text plus a dated retained document. SQL distinguishes internal approval, adoption, external acceptance, spending evidence and withdrawal, but does not interpret agency requirements or determine whether a document grants the stated authority. This is an appropriate recording boundary only if the UI and acceptance record preserve that limit. A workspace administrator is a recorder, not automatically the board, grantor or authorized signatory.
- Existing comments, assignment status and effective-baseline state deserve separate amendment and withdrawal exercises. A chronological event list alone does not establish that a recipient can determine which authority remains operative and what conditions remain unresolved.
- The public packet includes program-wide public events through its sequence, not just selected-revision events, at packet migration lines 47-50. That can preserve amendment history, but the disclosure review must cover every included record and baseline difference. Test cross-revision public/internal sentinels and hidden comment resolutions. Do not infer privacy from the single internal-note sentinel in the current SQL test.
- Packet retry requeues only `failed` jobs at packet migration lines 60-63. Establish the actual reachable cancellation states before claiming canceled-packet recovery. This is a source concern, not a reproduced failure. Lost-response retry, interrupted render/upload/finish, revocation while queued and exact cached packet hash also need new packet-specific evidence.
- `work-program-workflow-rls.test.ts` skips its entire suite unless LIVE_RLS is enabled. Its existing mutation checks cover expected sequence and independent reviewer selection, not every authority, privacy, identity or recovery guard. No green test result from this review is claimed. A harmless survivor and correctly diagnosed targeted failures remain necessary for changed guards.

## Answers to the ten direction questions

1. **What makes this the ultimate free planning operating system?** A planner should carry one defensible case from sources through alternatives, adopted decisions, funded delivery, public explanation and retained records. It must work for every core US planning practice in all fifty states and DC, with California depth, explicit territories and sovereign/overlapping authority. Independent installation, privacy, accessible use and recoverable work matter as much as features. Both demand methods need independent use-specific nationwide validation. No calendar or runtime limit reduces that destination.

2. **Can every type of US planner do their core work?** No. The capability matrix retains partial or unassessed environmental/development practice, complete RTP updates, full contract drawdown and forecasts, capital delivery and reimbursement, procurement from both sides, administered grants/tax measures, full aerial work and independent operation. OWP preparation is a narrower documented advance. M2d.2 must add review/adoption/amendments; actual reporting and closeout remain M2d.3-4. Existing modules already provide plausible homes for these jobs. A module inventory is not completion evidence.

3. **Does every state work in substance?** No such evidence exists in the reviewed records. The matrix says California is partial and the other states/DC are unassessed against the complete contract. Source inventories do not close those cells. Add real authority, period, funding and recipient cases rather than inheriting California assumptions. Territories remain explicit; tribal authority cannot be inferred from a state code.

4. **Is California the gold standard?** Not yet. Retained rural EDCTC preparation evidence is useful but does not prove MPO/RTPA differences, actual external acceptance, urban/coastal/border/tribal practice or a complete reporting/closeout cycle. Keep supported sums separate from unresolved predecessor dispositions and balances. Neither this review nor a synthetic database adoption creates EDCTC authority.

5. **Are both travel models validated for every published use nationwide?** No. The contract and current architecture retain separate AequilibraE and ActivitySim scientific gaps. The dated ActivitySim document establishes a historical execution path and borrowed-coefficient limits, not nationwide accuracy. Frozen development diagnoses and consumed holdouts cannot become fresh acceptance. Preserve use tiers, source uncertainty, method separation and unsupported states; do not fit a scalar or average models to improve a headline.

6. **What simple overlooked idea has the largest effect?** Show staff and every packet recipient a clear account of which version governs today, which changes are pending, which required decisions are evidenced, and what remains unresolved. The new state and history are a foundation, but A1 exposes the danger of treating newest and effective as the same fact. A recipient should not reconstruct operative authority manually from a long event log.

7. **Which old rule or decision is wrong?** Treating the latest saved revision as the only version that can receive authority evidence is wrong. Treating a preparation pass or predecessor CI as M2d.2 completion is also wrong. The roadmap's older bounded searches saying no named OWP workflow existed are historical findings and must not be repeated as current absence. Keep their dates while updating the present-gap account. The current failed direction gate is justified; changing metadata alone would conceal the new evidence boundary.

8. **What should be joined or deepened first?** Deepen Programs' existing immutable revisions, Documents custody and My Work assignments. Carry the same work-element/project identities into amendment comparisons and later reporting. Keep proposed budget, adopted baseline, external acceptance and spending conditions distinct. Do not build a separate general ledger, a duplicate approval system or a new OWP module. No evidence here warrants removing a core capability.

9. **What would prove these recommendations wrong?** A source/SQL counterexample that records external acceptance of the effective baseline after an amendment draft would falsify A1; the inspected conjunction cannot permit it. A browser case showing the disclosure acknowledgement clears on every changed revision/history would falsify A2. A recipient who correctly reconstructs applicable authority and pending changes from current packets without re-entry would weaken the need for a clearer authority account. Existing complete nationwide practitioner, recovery and model-acceptance evidence would overturn the broader gaps; no such evidence was found here.

10. **What is the highest-leverage next completed outcome?** Finish M2d.2 as a bounded engineering outcome on the established preparation case: independent assigned review, returned revision and resubmission, separately evidenced adoption/external acceptance/spending scope, a pending amendment that leaves the effective baseline usable, withdrawal/correction history, My Work follow-through and independently usable internal/public packets. Prove it at desktop and 390px on an identified build, through actual artifact arrival and interruption/revocation cases. Retain unresolved agency facts. Actual agency usefulness and authority require appropriate evidence; do not make a synthetic workflow claim larger by inventing those facts. M2d.3-4 and the full v1 floor remain open in the sole roadmap.

## Nine required perspectives

| Perspective | Assessment and implication |
|---|---|
| Transportation and travel-model science | OWP can schedule and fund modeling work without certifying its accuracy. Retain separate engines, declared uses and untouched acceptance requirements. |
| Land-use, statutory and development planning | The same program may commission land-use or RTP work. A work-product budget does not adopt its plan or settle governing authority. Complete plan and development workflows remain required. |
| Environmental, climate, resilience and equity | Work elements can retain studies and commitments; they do not establish environmental findings, valid forecasts or equity conclusions. Missing specialist and statutory outcomes remain in v1. |
| Community engagement, Title VI and public decisions | Public records need correct version meaning, accessible artifacts and private-content control. A2 prevents trusting public-copy acknowledgement. Participation and hearing usefulness need separate observed evidence. |
| Capital programming, grants, delivery and reimbursement | A1 blocks a normal delayed-approval case. Effective budget, permission to spend, actual cost, claim and reimbursement are distinct. Later reporting must reconcile them without duplicate claims. |
| Rural, tribal, small-agency and capacity-constrained use | Independent review must preserve authority while supporting limited staffing and actual external reviewer arrangements. Current reviewer selection requires another workspace writer; its adequacy for small agencies is unproved. Do not remove separation simply to make a fixture pass. |
| GIS, data interoperability, evidence custody and public records | Preserve source bytes, stable project/work IDs, complete amendment changes, exact versions and audience-specific artifacts. Hashes establish byte identity, not substantive accuracy or public suitability. |
| Agency operations, collaboration, accessibility, installation and recovery | Assignments and request IDs are useful foundations. Prove two-person work, revocation, stale state, browser recovery, worker restart, export delivery and a separate restore target. No browser or restore proof was collected here. |
| Adversarial product strategy | The likely costly omission is making each recipient reconstruct current authority from raw history. Close one useful agency review/amendment job and its recipient handoff before adding another disconnected feature. Preserve full v1 instead of declaring the narrow increment sufficient. |

## Disposition

Continue M2d.2 after fixing A1 and A2 and obtaining the missing implementation/acceptance evidence. No new module, reduced nationwide scope, scientific promotion or v0.44 release is justified by this review. This report is independent input, not the protocol synthesis or its required deliberate-bad-record/restoration proof.

Only this report is owned by reviewer A. The source checkout remained unchanged by this reviewer. Final status was inspected after writing; other worktree edits belong to the implementing lane and are not represented as reviewed final fixes.
