# OpenPlan documentation

Start here:

- [October 17 wrapped viewport source checkpoint](reviews/2026-10-17-viewport-reviewed-root-integration/STATUS.md): independently reviewed camera/parser/RPC correction, with focused checks accepted; migration 426, native SQL/RLS and desktop/390px acceptance remain open.
- [October 17 migration424 parser correction](reviews/2026-10-17-migration424-case-parser-correction/STATUS.md): the two-parentheses fix passes isolated PostgreSQL17.6 compilation with the original failure and a harmless survivor; full restore and native retained-context evidence remain open.
- [October 17 A0 native capture refusal](reviews/2026-10-17-a0-multiset-native-capture-result/STATUS.md): four requests complete before the protected-scope refusal; a saved-data reconstruction explains the digest through the accepted budget allocation. The attempt stays failed, with no oracle amendment or retry.
- [October 17 M1 held-caller review](reviews/2026-10-17-m1-operation-caller-independent/REPORT.md): accepted source and saved supplied controls; selected-history capture, the complete migration423 predecessor and native retained-context proof remain held.
- [October 17 A0 parent and collector review](reviews/2026-10-17-a0-multiset-parent-independent/REPORT.md): accepted exact parent source and saved supplied94 evidence, with earlier failures preserved. Native operation, post-failure risk disposition and admission remain separate and held.
- [October 16 reviewed preparation packets](reviews/2026-10-16-reviewed-proof-packets-root-integration/STATUS.md): joined engagement and budget source evidence, contrary reviews, failed trials and native-operation holds.
- [October 16 public entry observation](reviews/2026-10-16-public-ingress-partial/STATUS.md): read-only navigation and DOM measurements; registration, Auth and responsive visual acceptance remain untested.
- [October 16 read-only catalogue capture](reviews/2026-10-16-budget-settings-native-root-acceptance/REPORT.md): accepted manager and native request custody; budget target and later stages remain unadmitted.
- [October 16 missing reminder calendars](reviews/2026-10-16-reminder-calendar-coverage/REPORT.md): missing calendar rows are disclosed while UTC fallback continues; 49 simulated sweep tests pass, with actual delivery still unverified.

- [Roadmap](ROADMAP.md): status of every milestone and the next three tasks.
- [V1 product contract](product/V1_PRODUCT_CONTRACT.md): what v1 must deliver.
- [Known issues](ops/KNOWN_ISSUES.md): open defects and limits, including the October 12 review findings.
- [Hosted installation](#hosted-installation): the public installation at openplan-zeta.vercel.app since October 11, 2026, and its dated records.
- [Two-month review](reviews/2026-10-12-two-month-review/README.md): findings from August 11 to October 11 and the staged plan to v1.

Use this index to distinguish current instructions and priorities from historical
evidence. The application is in `openplan/` beneath the repository root.

| Question | Read |
|---|---|
| How should contributors and agents work? | [Repository AGENTS.md](../AGENTS.md), then [Contributing](../CONTRIBUTING.md). CLAUDE.md is a pointer to the same entry point |
| What must v1 deliver? | [V1 product contract](product/V1_PRODUCT_CONTRACT.md) |
| What is next, and what establishes completion? | [Roadmap](ROADMAP.md), the sole active queue, and [milestone definitions](product/MILESTONES.md) |
| What works, and what remains unproved? | [Capability matrix](product/US_PLANNING_CAPABILITY_MATRIX.md) and [known limitations](ops/KNOWN_ISSUES.md) |
| Why this direction? | [October 6 integration and v1 review](reviews/product-direction/2026-10-06-integration-review.md), [historical September OWP review](reviews/product-direction/2026-09-07-work-program-review.md), and preserved independent reports linked there |
| How is it implemented? | [Architecture](ARCHITECTURE.md) and current source |
| What shipped? | [Changelog](../CHANGELOG.md), Git tags and the release's actual CI/acceptance evidence |

The [review protocol](product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md) requires
periodic independent reassessment. Its check validates required records and
evidence bindings; it cannot certify professional usefulness or scientific truth.
The old [shared manual](product/AGENT_OPERATING_RULES.md) is a compatibility
pointer to AGENTS.md, not a second rulebook.

## Hosted installation

[Development release policy](product/DEVELOPMENT_RELEASE_POLICY.md) governs interim releases and authorized hosted operation.
For the hosted installation, start with the "Live hosted installation" section of [AGENTS.md](../AGENTS.md), then read the dated records newest first: the [October 12 review follow-up](reviews/2026-10-12-hosted-review-followup/STATUS.md), the [October 12 review fixes](reviews/2026-10-12-hosted-review-fixes/STATUS.md), the [October 11 demo AI and schema catch-up](ops/HOSTED_DEMO_AI_AND_GTFS_SCHEMA_2026-10-11.md) (405-migration hosted state, disabled GTFS commissioning), the [October 11 public cutover record](ops/HOSTED_LIVE_2026-10-11.md) (deployment identities; its migration, archive and rollback figures are superseded) and the [October 10 checkpoint](ops/HOSTED_RELAUNCH_2026-10-10.md) (implementation history). [Hosted recovery](../openplan/docs/ops/HOSTED_RECOVERY.md) names the current rollback procedure.

## Evaluate and operate

- [README](../README.md): local one-computer evaluation.
- [Self hosting](../openplan/docs/SELF_HOSTING.md): deployment profiles,
  configuration, external data flows and unfinished agency-operation proof.
- [Team commissioning](../openplan/docs/FIRST_DEPLOYMENT.md): what an independent
  operator must establish before real team use.
- [Runbook](../openplan/docs/ops/RUNBOOK.md): diagnosis and recovery boundaries.
- [v0.68 upgrade and recovery](../openplan/docs/ops/V068_UPGRADE.md): migration
  order, stopped workers, retained model decisions and GTFS cleanup limits.
- [Installed OpenCode project task](reviews/2026-09-10-opencode-native-spike/VERIFICATION.md): bounded native transport, exact retries, private history and release evidence.
- [Private engagement decision links](ops/ENGAGEMENT_DECISION_LINKS.md): reviewed source connections, retained corrections and interrupted-request recovery.
- [OWP reporting-period guide](ops/OWP_REPORTING.md): agency time, source costs, private valuations and corrected internal management reports.
- [September 7 OWP review and amendments](reviews/2026-09-07-owp-review/VERIFICATION.md): exact-version decisions, retained baselines, inspected exports and bounded engineering acceptance.
- [September 9 desktop Control repair](reviews/2026-09-09-control-main/VERIFICATION.md): visible demo/main commits and backed-up local database upgrades.
- [September 6 workspace/control checkpoint](reviews/2026-09-06-housekeeping/VERIFICATION.md): retained local archives, native layout and isolated update/recovery evidence.
- [Backup and restore](../openplan/docs/ops/BACKUP_AND_RESTORE.md): durable state,
  existing mechanisms, representative drills and missing full-recovery proof.
- [Security](../SECURITY.md) and [license notice](../LICENSE-NOTICE.md).

Local Supabase CLI evaluation, a developer's walkthrough instance and a supported
agency production installation are different environments. Current docs must
name which they describe. Do not infer free provider eligibility or production
readiness from an old setup guide.

## Practice requirements and current limitations

The [core requirements ledger](product/CORE_REQUIREMENTS_LEDGER.md) prevents restored requirements from disappearing. It maps full OWP, contract budgets, prior-RTP updates, capital/tax/grant administration, procurement, engagement, aerial work, agent providers, hosted trials and appearance to the single roadmap. The [workflow handoffs](product/WORKFLOW_HANDOFFS.md) identify the owning record and receiving role. These are requirements and gap assessments, not claims that every workflow exists.

The [October 16 budget catalog control record](reviews/2026-10-16-budget-settings-root-pure/STATUS.md) preserves the failed first trial and the passing inert remainder. Native capture remains held. The [separate A0 SQL18 installation record](reviews/2026-10-16-a0-native18-root-acceptance/REPORT.md) accepts only its exact isolated installation, not caller behavior or billing readiness.

Use the [current modeling status](modeling/STATUS_AND_VALIDATION.md) before interpreting old model metrics. The [September 6 shared-campaign handoff](reviews/2026-09-06-handoffs/SHARED_CAMPAIGNS.md) separates coverage/privacy repairs from incomplete browser file delivery. The [September 6 consolidation verification](reviews/2026-09-06-consolidation/VERIFICATION.md) separates implemented maintenance from deferred redesign. The [September 6 ODX and WaypointMap assessment](reviews/2026-09-06-handoffs/ODX_TRANSITION_RESEARCH.md) supplies the current processing-trial and controller-workflow references for M5b. The [preserved research packet](reviews/2026-09-04-pre-handoff/README.md) contains the full LAPM chapter review, selected other-state/federal manuals, competitor/reuse research and explicit reading limits.

## Planning and engineering references

- [Benefit-cost analysis workbench](ops/BCA_WORKBENCH.md): project evidence, annual calculations, program methods, recovery and exports.

- [Reading an adopted plan](../openplan/docs/READING_AN_ADOPTED_PLAN.md): sourced
  document extraction and human-reviewed use in a plan.
- [Architecture decisions](ADRs/): dated design rationale, including modeling,
  crash-source acquisition and the future MCP server boundary.
- [T3 Code research](reviews/2026-10-15-t3code-concepts/README.md) and its
  [approved roadmap disposition](reviews/2026-10-15-t3-roadmap/PROPOSAL.md): October 15
  decisions placing useful agent-operation patterns in existing milestones. The
  roadmap remains the queue.
- [Operations records index](ops/README.md): source contracts, release evidence,
  migration proof and historical handoffs.
- [Human observation protocol](product/PLANNER_OBSERVATION_PROTOCOL.md): actual planner/recipient and public-participant research, separate from simulated users.
- [First-week harness](../qa-harness/FIRST-WEEK-HARNESS.md): agent discovery,
  outcome verification, evidence capture and limits.
- [ActivitySim coefficient inventory and development transfer](modeling/activitysim-coefficients-2026-10-23/INVENTORY.md):
  [preregistration](modeling/activitysim-coefficients-2026-10-23/PREREGISTRATION.md),
  [retired, inconclusive result](modeling/activitysim-coefficients-2026-10-23/RESULT.md)
  and [verification](modeling/activitysim-coefficients-2026-10-23/VERIFICATION.md).
- [TBI 2019 development admission result](modeling/activitysim-tbi2019-2026-10-23/RESULT.md):
  frozen household split, public-source custody, synthetic instrument checks and
  historical-input blockers. Both arms remain inconclusive; survey outcomes stay unopened.
- [Opt-in ActivitySim GTFS transit skims](modeling/activitysim-transit-2026-10-23/README.md): scheduled skim definitions, source custody, synthetic controls, and dated regional plausibility.
- [Model observation/validation research](modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md),
  [frozen nationwide protocol](modeling/NATIONWIDE_VALIDATION_PREREGISTRATION_V1.json)
  and [engine landscape](modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md).

Workers have different environments and contracts. Start with their current
instructions under `workers/`, linked from the self-hosting guide. A successful
one-family suite is not all-worker or full scientific acceptance.

## Recent engineering checkpoints

October 15, 2026: [Integration secret rotation candidate](reviews/2026-10-15-integration-secret-rotation/STATUS.md) preserves retained credentials with a second read secret and primary-only writes. Local crypto and targeted source controls cover legacy formats, workspace/recipe identity and mixed-process configuration. No hosted rotation, queue recovery or restore acceptance is established.

The [October 14 deep-health correction](reviews/2026-10-14-ops-health-transport/STATUS.md) records actual SDK cancellation and malformed error-report recovery in an unmerged PR #326 candidate. Hosted checks and workflow delivery remain separate.

The [October14 explicit worker command](reviews/2026-10-14-owned-worker-cli/STATUS.md) joins private settings, exact credential references and preset options to the existing owned service. Actual child admission/replay/shutdown remains separate from processing and full application delivery.

**October 14 owned HTTP service candidate.** The [service record](reviews/2026-10-14-owned-worker-service/STATUS.md) joins the explicit Bundle to durable HTTP admission and owned shutdown. Delayed handlers retain the writer; captured service roles and bounds precede admission; SQLite contention returns unavailable. Source controls cover 30 cases and 32 faults per interpreter, with 286 related cases each. Corrected static review finds no further concrete defect. CLI, native/full receiver, default and hosted activation remain open.

**October 14 retained transit storage check.** The [storage-room record](reviews/2026-10-14-gtfs-storage-room/STATUS.md) covers original workspace usage, immutable archive retry accounting and actual HTTP cancellation. Exact retained bytes still determine custody. Source and diagnostic controls, scoped types and lint pass; concurrent usage is not an atomic reservation. Managed admission stays disabled on the hosted installation.

**October 14 explicit worker assembly candidate.** The [assembly record](reviews/2026-10-14-runtime-assembly/STATUS.md) links operator settings to the existing original worker graph. Guarded transports and roles remain pinned through recovery. The [hosted migration record](reviews/2026-10-14-hosted-aerial-authority/STATUS.md) separately records 11/12 application and backup/readback limits. A retained415 native recovery repeat passes four four-case cohorts and two SQL faults with matching worker hashes. Bundle factory native execution, the full receiver/Storage, service/default and legacy adoption remain open.


**October 14 operator configuration candidate.** The [dated record](reviews/2026-10-14-runtime-binding/STATUS.md) binds explicit new-root settings before admission, retains exact original replay and recovers known unpublished temporary files. Source controls cover each new case. Service/default activation and legacy-root adoption remain open.


These dated records sat at the top of this index until October 12, 2026, partly under the heading "Current authorities". They record bounded engineering evidence from October 6 through 14. They are not current authority; the documents under "Start here" are.

The [October 6 integration audit](reviews/2026-10-06-integration/INTEGRATION.md) records worktree custody and the next development boundary. The [original October independent review](reviews/2026-10-01-independent-code-review/FINAL_REPORT.md) is preserved beside its later [fix disposition](reviews/2026-10-01-independent-fixes/DISPOSITION.md).

- [Land-use restore cascade correction](reviews/2026-10-07-land-use-authority/RESTORE_CASCADE_FAILURE.md): reproduced restore failures, additive migration and remaining full-drill boundary.

The [October 14 custody roster recovery candidate](reviews/2026-10-14-aerial-custody-recovery/STATUS.md) preserves missing original artifact identities and repairs pending package readiness while keeping human verification. Application recovery precedes the separate held-row guard. Hosted, browser and full worker acceptance remain open.

The [October 14 progress delivery candidate](reviews/2026-10-14-progress-delivery/STATUS.md) retains original accepted/running callback bytes before a supervised POST. Current actor access, exact retry, refusal and received-response custody stay separate from artifact delivery and terminal completion. The worker default remains unchanged.

The [atomic model run-state correction](reviews/2026-10-08-model-custody-metadata/RUN_STATE_PUBLICATION.md) protects local stage handoffs from truncated writes. Attempt ownership and whole-stage replay remain unfinished.

The October 8 model recovery checkpoints cover [stage preparation and artifact delivery](reviews/2026-10-08-model-custody-metadata/STAGE_RECOVERY.md), [KPI receipt recovery](reviews/2026-10-08-model-custody-metadata/KPI_RECOVERY.md) and [retained agreement computation](reviews/2026-10-08-model-custody-metadata/AGREEMENT_COMPUTATION.md). They preserve interrupted-work boundaries and do not establish full stage replay or scientific acceptance.

The [October 11 model journal snapshot candidate](reviews/2026-10-11-worker-journal-snapshot/STATUS.md) implements a private SQLite backup-API command with populated WAL, retained-start and publication controls. It covers one journal after declared quiescence; installation-wide recovery and scientific acceptance remain open.

The [October 11 coordinated known-root recovery point](reviews/2026-10-11-coordinated-worker-point/STATUS.md) joins populated model journals, the complete known synthetic worker root and the full database/transit point. Separate local-cluster recovery retains the original native command bytes without computation. Same-host storage, legacy command scope and the remaining M3 limits stay explicit.

The [manual engagement case](reviews/2026-10-07-engagement-manual-case/VERIFICATION.md) records source-to-response-to-decision custody and downloaded review files. The [approval-label follow-up](reviews/2026-10-07-engagement-manual-case/STATUS_LABELS.md) distinguishes review approval from public release. The [source-label follow-up](reviews/2026-10-07-engagement-manual-case/SOURCE_LABELS.md) verifies source authorship in newly downloaded PDF and workbook files. Its [handoff target follow-up](reviews/2026-10-07-engagement-manual-case/TARGET_BROWSER.md) verifies the project-link refresh correction in T3.

The October 7 land-use checkpoints record [frozen staff history](reviews/2026-10-07-land-use-authority/FROZEN_WORKBENCH.md), [plan-kind connections](reviews/2026-10-07-land-use-authority/PLAN_KIND_CONNECTIONS.md), [reconciliation backend](reviews/2026-10-07-land-use-authority/RULE_RECONCILIATION_BACKEND.md) and the remaining [older-draft reconciliation design](reviews/2026-10-07-land-use-authority/DRAFT_RULE_RECONCILIATION_DESIGN.md). These remain M1 work with explicit native and rendered acceptance limits. The [checklist recovery acceptance](reviews/2026-10-07-land-use-authority/RULE_RECONCILIATION_ACCEPTANCE.md) now records identified HTTP concurrency and a bounded desktop/390px T3 recovery journey, including the downloaded copy and mobile layout correction. The [creation and context acceptance](reviews/2026-10-07-land-use-authority/CREATION_CONTEXT_ACCEPTANCE.md) adds specific-plan creation, retained area and authority, older-draft review, and interrupted stop recovery in T3. The [frozen history and public context check](reviews/2026-10-07-land-use-authority/FROZEN_PUBLIC_CONTEXT_ACCEPTANCE.md) adds identified public context and downloaded-byte checks, with omissions and their later [public content correction](reviews/2026-10-07-land-use-authority/PUBLIC_CONTENT_FOLLOWUP.md) recorded separately. The [synthetic publication and report check](reviews/2026-10-07-land-use-authority/PUBLICATION_REPORT_CUSTODY.md) adds populated adopted context, verified report identity, mobile correction and an explicit request-observer limitation. The [retained report decision check](reviews/2026-10-07-land-use-authority/REPORT_ADOPTION.md) adds native-bound adoption details and frozen related-plan references, with desktop/390px decision and empty-reference evidence. The [report-map follow-up](reviews/2026-10-07-land-use-authority/REPORT_MAPS.md) adds edition-bound authenticated map reads, 390px provider-unavailable evidence and native empty-layer checks. Actual map drawing and nonempty geography remain unproved. The [implementation-report check](reviews/2026-10-07-land-use-authority/IMPLEMENTATION_REPORT_CUSTODY.md) verifies retained identity and statuses, including a native later-status change and a matching downloaded report. The [direct source-download correction](reviews/2026-10-07-land-use-authority/REPORT_EXPORT_CUSTODY.md) applies the retained-record checks to downloads, with matching T3 files and scoped refusal controls. The [transaction backend checkpoint](reviews/2026-10-07-land-use-authority/IMPLEMENTATION_REPORT_TRANSACTION.md) adds native atomic writes and exact receipts. The [report-request recovery check](reviews/2026-10-07-land-use-authority/IMPLEMENTATION_REPORT_RECOVERY_2026-10-07.md) connects that reader, route and form, with native exact replay, T3 desktop/390px lost-response recovery, matching downloads and a mobile wrapping correction. Exact-head GitHub checks and merge remain pending; native date entry, the OS file chooser and practitioner acceptance are not established.

The [October 11 managed admission and progress point](reviews/2026-10-11-managed-stage-point/STATUS.md) adds original native claim/progress recovery, execution-admission and attempt-root preservation. It exercises existing helpers; normal polling, engine resume and the remaining M3 floor stay open.

The [October 11 complete selected worker-root snapshot candidate](reviews/2026-10-11-worker-root-snapshot/STATUS.md) adds a supported private-root package command, native SQLite/WAL controls and five known-root checks. Fresh package copies recover original managed receipts without computation; installation-wide recovery and the remaining M3 floor stay open.

The [October 11 selected worker-root set candidate](reviews/2026-10-11-worker-root-set/STATUS.md) retains exact selection bytes, binds components to the initial source inventory and publishes one final set manifest. Five known roots and a relocated copy verify. It does not discover omitted installation roots or establish a new database/Storage cut. The failed T3 host retry remains explicit.

The [October 11 retained recovery-packet candidate](reviews/2026-10-11-recovery-point-manifest/STATUS.md) binds declared database/Storage artifacts, roles, key, configuration and a verified worker-root set. The 3,092-file encrypted transport restores exact packet bytes/modes, preserving original backend mode metadata and failed trials. This is an offline retained-artifact check; installation-wide consistency and independent commissioning remain open.

The [October 11 explicit worker inventory candidate](reviews/2026-10-11-installation-worker-inventory/STATUS.md) requires declarations for each known worker family and retains exact private configuration before producing a selected-root inventory. Its source audit distinguishes model, imagery, OCR, email, synthesis and native connector state. Historical-fixture integration is verified; installation coverage and commissioning remain unassessed.

The [October 11 native OCR text-layer recovery proof](reviews/2026-10-11-ocr-worker-recovery/STATUS.md) recovers exact original callback bytes from a stopped private-root package without another download or extraction. A blank page, original admission replay and changed-request refusal survive. Scanned OCR quality, a live OpenPlan consumer and the remaining M3 floor stay open.

The [October 11 OCR inventory/root-set integration proof](reviews/2026-10-11-ocr-inventory-root-set/STATUS.md) binds a selected synthetic configuration and root through both existing operators, then continues the original result in a fresh runtime. The consumer reads a persisted ledger, and 53 controls pass. One fixture is configured; the other 14 families and installation coverage remain unassessed.

The [October 11 aerial admission counterexample](reviews/2026-10-11-odm-restart-reproduction/STATUS.md) reproduces a queued ODM request receiving a new job/admission identity after complete stopped-root restoration. No imagery or engine work runs. The defect remains open; a verifying file package does not establish recovery of memory-only accepted work.

The [October 11 disconnected aerial journal candidate](reviews/2026-10-11-odm-admission-journal/STATUS.md) preserves original admission and start-intent records through actual stopped-root capture and relocated journal replay. The HTTP worker remains disconnected; the native restart defect and source/engine/result/artifact integration remain open.

The [October 11 disconnected aerial source candidate](reviews/2026-10-11-odm-source-custody/STATUS.md) preserves exact complete local source bytes and their original plan through an actual interrupted copy, stopped-root capture and fresh-copy resumption. The HTTP worker remains disconnected; downloads, engine effects and full worker recovery stay open.

The [October 11 native aerial draft counterexample](reviews/2026-10-11-odm-draft-reconciliation/STATUS.md) shows repeated uploads creating duplicate files and repeated initialization overwriting metadata. Original draft bytes survive restored API startup even though no registered task is found. No commit or reconstruction runs; safe engine-effect reconciliation remains open.

The [October 11 disconnected aerial engine journal](reviews/2026-10-11-odm-engine-effects/STATUS.md) freezes original source/engine/settings/task identity, preserves exact commands and replies, and refuses a second first-issue flag. Stopped-root copy replay preserves unresolved effects. Actual engine custody, ZIP-derived imagery and runtime recovery remain open.

The [October 11 captured aerial draft inspector](reviews/2026-10-11-odm-draft-custody/STATUS.md) compares verified captured metadata and upload bytes with the original saved plan. Native partial/complete drafts match; duplicate uploads, overwritten metadata and changed bytes refuse. Results grant no transport permission. Complete worker recovery remains open.

The [October 11 original ZIP-derived source candidate](reviews/2026-10-11-odm-zip-derived-custody/STATUS.md) retains ordered member bytes and distinct image-slot filenames under the original archive/admission/context. Actual interrupted-copy recovery resumes from the captured retained ZIP without the original download. Engine-journal and runtime integration remain open.

The [October 11 ZIP engine-journal integration candidate](reviews/2026-10-11-odm-zip-engine-integration/STATUS.md) binds actual derived image bytes and original archive lineage before command intents. Stopped-root replay preserves uncertain commands; actual cached engine drafts compare exact original slots. Runtime dispatch and complete worker recovery remain open.

The [October 11 opt-in durable aerial HTTP admission candidate](reviews/2026-10-11-odm-runtime-admission/STATUS.md) preserves exact original HTTP receipts and pending work through stopped-root restoration, while holding uncertain starts. Missing original journal/seal refuses startup. Source/actor/engine stages, outputs/callback custody and full worker recovery remain open.

The [October 11 owned aerial runtime preparation candidate](reviews/2026-10-11-odm-runtime-preparation/STATUS.md) binds original actor/context and task to retained local inputs and engine plans inside the actual owned runtime. Native interrupted preparation and relocated-copy recovery pass. Trusted context/URL intake, live authority, transport/results and complete worker recovery remain open.

The [October 11 SQLite concurrency correction](reviews/2026-10-11-odm-sqlite-companion-race/STATUS.md) tolerates only retired transient companions, preserves unsafe/unavailable-file refusal and passes 54 tests/59 controls on two Python versions plus 200 serial native concurrency pairs. Inherited actual CI and stopped-root preparation recovery pass; exact-head GitHub checks remain separate. Preserve the main merge hold.

The [October 11 owned aerial draft candidate](reviews/2026-10-11-odm-runtime-draft/STATUS.md) advances one original initialization/upload through the actual admission runtime, retained source and command journal. Uncertain effects hold without reissue and complete drafts leave commit unissued. Twenty tests/31 controls and actual cached-engine capture/restore pass; supplied permission is not live authority. Actual cancellation, trusted context/URL intake, processing/results/callbacks and full worker recovery remain open. Preserve the main merge hold.

The [October 11 supervised aerial HTTP candidate](reviews/2026-10-11-odm-draft-http/STATUS.md) adds one original init/upload transport with streaming, deadline, cancellation and parent-lifetime ownership. It preserves unresolved effects and holds commit. Native proof caught and corrected initialization metadata loss. All 31 tests/47 controls, 18 actual-CI suites and pinned-engine capture/restore checks pass. Fourteen nested documentation tests and the direction check pass; live authority, URL intake, processing and full worker recovery remain open. Main merges remain held.

The [October 11 retained aerial URL source candidate](reviews/2026-10-11-odm-url-source-custody/STATUS.md) saves original complete source bytes before owned preparation, with immutable context, slot receipts and bounded orphan attempts. Forty tests/48 controls and actual interrupted two-root recovery pass. Completed receipts prevent refetch and corrupt completed bytes refuse. Supervised network transport, live authority, trusted dispatch, processing/results/callbacks and full worker recovery remain open. Preserve the main merge hold.

The [October 11 supervised aerial URL source candidate](reviews/2026-10-11-odm-url-transport/STATUS.md) stops original network intake on deadline, cancellation or abrupt owner exit. Available loopback redirect targets, local TLS, 33 tests/59 controls and actual interrupted two-root recovery pass. Original source receipts prevent refetch. Public network, live authority, trusted dispatch, processing/results/callbacks and full worker recovery remain open. Preserve the main merge hold.

The [October 11 original aerial URL intake candidate](reviews/2026-10-11-odm-runtime-url-intake/STATUS.md) saves supplied original settings before fetch and source mapping before preparation. All 39 tests/56 controls and actual interrupted HTTP recovery pass. Recovery keeps original actor/engine/options and can replay completed preparation without the download root. Missing original records or bytes hold without replacement or refetch. Live authority, trusted dispatch, processing/results/callbacks and full worker recovery remain open. Main merges stay held.

The [October 11 original URL-to-draft candidate](reviews/2026-10-11-odm-url-draft-pipeline/STATUS.md) advances one original command from frozen URL settings and bytes. Twenty composition tests/32 controls and actual composed HTTP body cancellation pass. Native source intake and pinned engine drafts retain uncertain intents and hold commit. Supplied authority, processing/results/callbacks and full worker recovery remain unassessed. Main merges stay held.

The [original dispatch custody candidate](reviews/2026-10-11-odm-original-dispatch-custody/STATUS.md) preserves exact supplied request bytes, original actor and nullable project before URL intake. It compares frozen settings and engine context with the private receipt and refuses recapture after input work. Supplied authorship and current authority remain unassessed. The coordinator lifts the merge hold at 2026-10-12T02:46:46Z, subject to serial merges and production health verification.

The [private application dispatch producer candidate](reviews/2026-10-11-odm-private-dispatch-producer/STATUS.md) saves exact request text outside member-readable jobs before optional dispatch and checks current original scope through service-only RPCs. It retains nullable project and original actor and refuses uncertain storage replies. Focused application, native mutation, project-lock, local SQL restore, installed CLI upgrade and actual RPC interruption checks pass. Full worker recovery and hosted integration remain open; no engine permission is established.

The [October 12 combined M3 candidate](reviews/2026-10-12-m3-owned-stack-integration/STATUS.md) joins the owned recovery and aerial stack with the separate worker-root parent and fetched main. Its worker, operations, application and installed-RPC checks pass, including a narrow native control-panel layout correction. The [private reader](reviews/2026-10-12-odm-private-dispatch-reader/STATUS.md), [receipt capacity correction](reviews/2026-10-12-odm-private-reader-capacity/STATUS.md) and [current draft authority](reviews/2026-10-12-odm-private-draft-authority/STATUS.md) retain their distinct limits. Hosted migration, current-head CI, native engine attestation and full-worker acceptance remain separate.

The [October 12 deadline-test clock correction](reviews/2026-10-12-odm-deadline-test-clock/STATUS.md) measures the aerial pipeline's actual start instead of including fixture setup. It removes the earlier test allowance and passes the existing harmless and broken deadline controls under Python 3.14 and 3.11. Production code and its deadline stay unchanged; exact-commit CI remains separate.


The [October 11 native readiness correction](reviews/2026-10-11-odm-native-readiness-race/STATUS.md) fixes a partial listener write in the actual aerial recovery harness. Paused atomic publication passes; deliberately broken direct publication reproduces GitHub's JSON-read failure. Worker behavior and the main merge hold stay unchanged.

## Historical evidence

[Archived plans](archive/plans/) preserve superseded queues. The [roadmap evidence log](archive/ROADMAP_EVIDENCE_LOG_2026-08-24_TO_2026-10-12.md) keeps the dated checkpoints the roadmap carried from August 24 to October 12, 2026. The [September 6 archive](archive/2026-09-06-consolidation/INDEX.md) retains replaced instructions and guides with original-byte hashes.
[Dated reviews](reviews/), [modeling studies and research](modeling/)
and [ADRs](ADRs/) retain what was known and decided at the time. A later review
may supersede a recommendation without changing the old finding or frozen bytes.

The August 25 independent reviews proposed smaller release sequences; the full
v1 contract supersedes those scope proposals. The September 6 consolidation
supersedes earlier active-roadmap and operator-guide wording where identified
in the review. Historical success claims remain bound to their original source,
build and evidence quality.

Do not commit raw session histories, credentials or confidential client/acceptance
records. Record sanitized findings, source paths, dated review coverage and
appropriate exact evidence hashes. Prior commercial-era deletions remain in Git
history; this consolidation does not repeat a mass deletion.

- [OWP preparation implementation and verification](reviews/2026-09-06-handoffs/OWP_PREPARATION_IMPLEMENTATION.md) — bounded Programs preparation increment and unfinished acceptance evidence.

Contract management: [operator workflow](ops/CONTRACT_RECONCILIATION.md) and [v0.46 engineering evidence](reviews/2026-09-07-contract-reconciliation/VERIFICATION.md). Full M11 remains open.

- [OWP reimbursement operation](ops/OWP_REIMBURSEMENT.md): reviewed supporting packets, source sharing and correction boundaries.
- [OWP closeout reconciliation](ops/OWP_CLOSEOUT_RECONCILIATION.md): private saved assessments, accounting-period closure/reopening and bounded next-cycle carryover.

- [v0.59.0 translation recovery verification](reviews/2026-09-13-m9b-translation-writes/RELEASE_VERIFICATION.md): exact-source staff writes, retained worker output, public retry custody and production/upgrade evidence.

- [v0.61.1 optional-project report API](reviews/2026-09-14-report-api-project/PUBLICATION.md): published after final CI; actual API reads, normal project controls and preserved downloads.
- [v0.61.0 report context and private history](reviews/2026-09-14-m9b-report-lineage/RELEASE_VERIFICATION.md): exact internal history, original/changed files, browser retry and upgrade evidence; published after final CI.
- [v0.60.0 decision links and public-copy privacy](reviews/2026-09-14-m9b-decision-reports/RELEASE_VERIFICATION.md): retained private context, interrupted recovery and actual public artifact/privacy checks; final publication recorded separately.

- [M9b synthesis response workflow](reviews/2026-09-27-synthesis-response-links/BROWSER_VERIFICATION.md): staff controls, restored-copy recovery, desktop/390px journeys and installed-schema verification. Local gates and exact-commit CI pass on `10e0d694`. The [decision synthesis foundation](reviews/2026-09-27-synthesis-response-links/DECISION_SYNTHESIS_FOUNDATION.md) has candidate capture and integrity checks; decision display, readable exports, activation and release remain unfinished. [HTTP checkpoint](reviews/2026-09-27-synthesis-response-links/HTTP_VERIFICATION.md) and [initial groundwork](reviews/2026-09-27-synthesis-response-links/IMPLEMENTATION.md) preserve earlier findings.
- [v0.64.0 reviewed synthesis verification](reviews/2026-09-27-synthesis-response-links/RELEASE_VERIFICATION.md): response links, versioned decision evidence and private reviewed files. [Publication](reviews/2026-09-27-synthesis-response-links/PUBLICATION.md) records final CI, tagging and the retained demo upgrade.
- [Explicit synthesis execution queue candidate](reviews/2026-10-07-synthesis-execution-queue/DESIGN.md): staff scheduling, retained queue receipts, continuous worker discovery, desktop/390px journeys, synthetic proposal import and process recovery. [Release checks](reviews/2026-10-07-synthesis-execution-queue/RELEASE_VERIFICATION.md) distinguish completed checks from pending validation. This is not V1 acceptance or evidence of interpretation quality.
- [Resumable synthesis input foundation](reviews/2026-09-30-synthesis-generation/INPUT_PROTOCOL.md): complete-input custody with mutation evidence; this preparation record does not establish model dispatch or a generation interface.
- [Retained synthesis plans](reviews/2026-09-30-synthesis-generation/PLANS.md): private request-bound task staging, cancellation fences and interrupted acknowledgement recovery. The v0.65.0 release adds a local worker; the generation interface remains unfinished.
- [v0.65.0 local synthesis execution](reviews/2026-09-30-synthesis-generation/RELEASE_VERIFICATION.md): retained authorizations, original outputs, interrupted recovery and saved task scheduling. [Publication](reviews/2026-09-30-synthesis-generation/PUBLICATION.md) records final checks and tagging; complete staff-facing generation remains open.
- [M1 plan-context commands](reviews/2026-10-07-land-use-authority/CONTEXT_ROUTE.md): scoped staff API reads/writes and native persistence checks. Identified HTTP and simultaneous database saves are verified. [Frozen context](reviews/2026-10-07-land-use-authority/CONTEXT_SNAPSHOT.md) adds snapshot retention and save/freeze race checks. [Draft revisions](reviews/2026-10-07-land-use-authority/DRAFT_REVISION.md) establish the transaction precondition, and [atomic freeze persistence](reviews/2026-10-07-land-use-authority/FREEZE_TRANSACTION.md) passes rollback-only checks; interface, atomic creation/freeze and full M1 acceptance remain unfinished.
- [M1 reviewed plan history](reviews/2026-10-07-land-use-authority/FROZEN_WORKBENCH.md): saved identity, rules and context, explicit version links and read-only historical views. Identified native reads pass; rendered acceptance remains open.
- [M1 plan-kind readiness](reviews/2026-10-07-land-use-authority/READINESS_RECONCILIATION.md): required sections remain visible after checklist changes. Specific-plan selection, older-draft reconciliation and rendered acceptance remain unfinished.
- [v0.66.0 context CLI publication](reviews/2026-09-30-synthesis-generation/CONTEXT_CLI_PUBLICATION.md): dependent scheduling, original-output recovery, final CI/isolation/upgrade evidence and retained local handoff. Staff generation and proposal import remain unfinished.
- [Selected synthesis output verification](reviews/2026-09-30-synthesis-generation/SELECTED_RESULTS.md) and [current staff history](reviews/2026-09-30-synthesis-generation/HISTORY_ACCESS.md): original-byte joins and authenticated historical segment choices, shipped in v0.66.0.
- [Context dependencies](reviews/2026-09-30-synthesis-generation/CONTEXT_DEPENDENCIES.md) and [retained content](reviews/2026-09-30-synthesis-generation/CONTEXT_CONTENT.md): complete source/result dependency inventory and bounded content frames, shipped in v0.66.0.
- [Context requests](reviews/2026-09-30-synthesis-generation/CONTEXT_REQUESTS.md), [continuation protocol](reviews/2026-09-30-synthesis-generation/CONTEXT_CONTINUATION.md) and [retained staging](reviews/2026-09-30-synthesis-generation/CONTEXT_STAGING.md): exact native bindings, cumulative state and original frame custody. These dated stage records precede the v0.66.0 release.
- [Context execution](reviews/2026-09-30-synthesis-generation/CONTEXT_EXECUTION.md) and [CLI candidate verification](reviews/2026-09-30-synthesis-generation/CONTEXT_CLI_RELEASE.md): native authority, predecessor replay and durable recovery now shipped in v0.66.0. The publication record supersedes their pending release statements.
- [Next context history integration](reviews/2026-09-30-synthesis-generation/CONTEXT_HISTORY_NEXT.md): read-only findings for current-staff verification before thematic proposals and explicit import. This remains M9b work.
- [October 1 v1 resumption](reviews/2026-10-01-context-history/RESUMPTION.md), [context-history verification](reviews/2026-10-01-context-history/VERIFICATION.md), [thematic proposal conversion](reviews/2026-10-01-context-history/THEMATIC_PROPOSAL.md) and [authenticated input custody](reviews/2026-10-01-context-history/THEMATIC_INPUTS.md): implementation ownership, immediate M9b dependencies, reproduced defects and pending acceptance boundaries.
- [Thematic worker input reconstruction](reviews/2026-10-01-context-history/THEMATIC_PREPARATION.md): explicit native preparation authority and pinned historical replay; input sealing and execution remain unfinished.
- [Reconstructed thematic input custody](reviews/2026-10-01-context-history/THEMATIC_CUSTODY.md): private original output storage, cancellation recovery and remaining whole-source seal work.
- [Complete-source thematic input seal](reviews/2026-10-01-context-history/THEMATIC_SEAL.md): exact source membership, bounded proof inventory and durable custody; execution and staff import remain unfinished.
- [Shared thematic preparation](reviews/2026-10-01-context-history/THEMATIC_SHARED_PREPARATION.md): request-scoped reuse of immutable originals while preserving per-contribution replay and current authority.
- [Complete thematic proposal inputs](reviews/2026-10-01-context-history/THEMATIC_PROPOSAL_INPUTS.md): sealed whole-source replay, exact original evidence and final current-access checks before task preparation.
- [Versioned thematic continuation](reviews/2026-10-01-context-history/THEMATIC_CONTINUATION.md): bounded original-evidence frames, checked replay and unreviewed proposal conversion; native execution and staff import remain unfinished.
- [Original thematic proposal import](reviews/2026-10-01-context-history/THEMATIC_IMPORT.md): a new staff draft retains original evidence and preserves earlier approvals; connected browser controls remain unfinished.
- [Thematic Analysis UI continuation](reviews/2026-10-02-thematic-ui/PROGRESS.md): landed backend integration and unreleased browser import/recovery work, with current evidence and remaining acceptance work.
- [October context handoff](reviews/2026-10-06-engagement-case/CONTINUATION_HANDOFF.md) and [inspected thematic inputs](reviews/2026-10-06-engagement-case/THEMATIC_INPUT_HANDOFF.md): recoverable context requests, exact inspected-choice retention and remaining browser/thematic workflow boundaries.
- [Repeated contribution inspection](reviews/2026-10-07-engagement-evidence-refocus/VERIFICATION.md): production desktop/390px focus recovery, keyboard checks and the remaining full thematic journey limits.
- [Current-staff thematic proposal history](reviews/2026-10-01-context-history/THEMATIC_HISTORY.md): reconstructs original selected outputs after cancellation or requester departure; explicit staff import and browser acceptance remain unfinished.
- [Durable thematic scheduling](reviews/2026-10-01-context-history/THEMATIC_SCHEDULER.md): saved complete-grant task inventory including the final proposal, with original-output recovery. The subsequent history checkpoint above adds original proposal replay; staff import remains unfinished.
- [Native thematic execution](reviews/2026-10-01-context-history/THEMATIC_EXECUTION.md): authorized single tasks and original-response recovery; the subsequent scheduler checkpoint above adds complete-grant execution.
- [Native thematic staging](reviews/2026-10-01-context-history/THEMATIC_STAGING.md): exact evidence-frame custody and final proposal reference; the subsequent execution checkpoint above records authorization and worker recovery.
- [v0.63.0 exact staff synthesis approval](reviews/2026-09-27-synthesis-approval-recovery/RELEASE_VERIFICATION.md): private version-specific approval/withdrawal, original history, interrupted retry and concurrent-write evidence; [publication and final CI](reviews/2026-09-27-synthesis-approval-recovery/PUBLICATION.md).
- [v0.62.0 retained synthesis source and staff review](reviews/2026-09-14-m9b-synthesis-custody/RELEASE_VERIFICATION.md): complete selected-source custody, reasoned revisions, interrupted retry and retirement of unsafe legacy generation; [published after final CI](reviews/2026-09-14-m9b-synthesis-custody/PUBLICATION.md).

- [Engagement synthesis operating guide](ops/ENGAGEMENT_SYNTHESIS_REVIEW.md): retained source selection, reasoned corrections, earlier history and interrupted-save recovery.

The [native engine observation candidate](reviews/2026-10-12-odm-native-engine-attestation/STATUS.md) binds one supported Linux NodeODM original to daemon and process-root observations. Its defaults and processing commit remain held.

The [SQLite companion retirement correction](reviews/2026-10-13-odm-retired-sqlite-companions/STATUS.md) preserves the committed original after a transient file is unlinked, while refusing present unsafe files and aliases.

The [October13 corrected combined worker candidate](reviews/2026-10-13-m3-corrected-stack/STATUS.md) joins the recorded recovery stack, native engine observer and journal retirement correction with current main. It retains separate CI, hosted and production boundaries.

The [GTFS deadline fixture correction](reviews/2026-10-13-gtfs-intake-deadline-fixture/STATUS.md) preserves the short ignored-upload deadline, restores the normal recovery deadline and checks cancellation before archive reconciliation. Production intake remains unchanged.

The [native private-authority composition](reviews/2026-10-13-odm-native-private-authority-composition/STATUS.md) joins actual RPC access, original engine attestation and real draft init/upload transport in an owned fixture. Processing stays held; installation, physical-host recovery and scientific acceptance remain separate.

The [intake clock fixture correction](reviews/2026-10-13-odm-intake-clock-fixture/STATUS.md) compares nested fetch deadlines with the actual shared intake deadline. Controlled startup delay stays outside that budget; production limits remain unchanged.

The [aerial CI wrapper correction](reviews/2026-10-13-odm-ci-job-budget/STATUS.md) preserves every execution command while extending the outer job limit after a recorded cancellation. Worker and test deadlines stay unchanged; current-head GitHub completion remains required.

The [native interrupted-upload proof](reviews/2026-10-13-odm-native-uncertain-interruption/STATUS.md) exits an owned process after a checked real response but before journal saving. Relocated recovery holds the uncertain upload without another authorization or transport; this does not reconcile it or grant retry permission.

The [admission deadline fixture correction](reviews/2026-10-13-gtfs-admission-deadline-fixture/STATUS.md) keeps upload timing separate from durable source resolution, observes physical abort before reconciliation and refuses late replies without changing production budgets.
The [commit reply correction](reviews/2026-10-13-odm-commit-reply-contract/STATUS.md) matches the original UUID observed from the pinned engine, preserves exact reply bytes and refuses invalid old mock receipts without rewriting them. Processing remains held.

The [task metadata parser](reviews/2026-10-13-odm-task-observation/STATUS.md) binds supplied status replies to the original plan and preserves reported options separately from execution settings. Metadata grants no permission or quality claim; runtime polling remains unconnected.

The [failed-task stopped-root probe](reviews/2026-10-13-odm-committed-task-restore/STATUS.md) retains one known backend task’s API identity and failed status across an exact root copy. It does not authorize a new engine identity or establish full worker recovery.

The [managed aerial state correction](reviews/2026-10-13-odm-managed-state-root/STATUS.md) requires a declared retained directory apart from scratch, refuses missing recovery roots and checks original receipt replay with fresh replacement scratch. The operator still verifies its backing storage and installation-wide recovery inventory.

- [Separate retained aerial task metadata root](reviews/2026-10-13-odm-task-observation-retention/STATUS.md), current candidate and bounded source/native evidence.

- [Local aerial task metadata command](reviews/2026-10-13-odm-task-observation-cli/STATUS.md), supplied private replies, exact digest reads and bounded operator summaries.
- [Aerial HTTP reply framing](reviews/2026-10-13-odm-reply-framing/STATUS.md), incomplete declared replies refuse before acknowledgement publication.
- [Original aerial task reads](reviews/2026-10-13-odm-original-task-read/STATUS.md), owned network reads and exact retained replies with separate claim limits.
- [Explicit original task command](reviews/2026-10-13-odm-original-task-command/STATUS.md), private native fetch inputs, operator interruption and saved-digest recovery.
- [Owned runtime task observations](reviews/2026-10-13-odm-runtime-observation/STATUS.md), original application bindings, current access and private reported task records.
- [Original processing commit custody](reviews/2026-10-13-odm-original-processing-commit/STATUS.md), explicit original access, owned POST, uncertain holds and exact private reply replay.

- [Complete owned OpenCode fixture receipts](reviews/2026-10-13-opencode-receipt-fixture/STATUS.md), actual process interruption, unchanged production shutdown and current main failure hold.

- [Original uncertain commit inspection](reviews/2026-10-13-odm-uncertain-commit-inspection/STATUS.md), current task observations with a missing acknowledgment held separately.

- [Supplied output archive custody](reviews/2026-10-13-odm-output-archive-custody/STATUS.md), bounded complete private bytes, member inventory and interruption recovery without publication or quality promotion.
- [Original output archive HTTP](reviews/2026-10-13-odm-original-output-http/STATUS.md), supervised fixed-task downloads with ownership, cancellation and bounded byte writing.
- [Original runtime output intake](reviews/2026-10-13-odm-runtime-output-intake/STATUS.md), current access, confirmed download receipts and private archive recovery without publication.

- [Private original aerial products](reviews/2026-10-14-odm-private-products/STATUS.md), exact selected member bytes and interrupted recovery under current access, without delivery or quality promotion.
- [Protected Linux transfer preparation](reviews/2026-10-14-linux-transfer-preparation/STATUS.md), pinned source and separate retained fixtures, encrypted transport and open separate-host limits.
- [Selected-schema original output recovery](reviews/2026-10-14-odm-output-schema-recovery/STATUS.md), populated isolated fixture upgrades, logical restores and current actor checks.
- [Joined candidate transit and export observations](reviews/2026-10-14-m3-joined-preview/STATUS.md), identified T3 views, original geometry and native GeoPackage checks with explicit limits.
- [Transit archive period and staff drawing guidance](reviews/2026-10-14-gtfs-source-period-guidance/STATUS.md), dates and caller wording with bounded source controls and desktop/390px T3 observations.

The [October 14 aerial callback retry candidate](reviews/2026-10-14-aerial-callback-retry/STATUS.md) resumes interrupted application from the same retained JSON payload, refuses changed worker/payload identity and guards status writes against concurrent changes. The compiled route and SDK pass isolated database HTTP checks; full deployment and durable output delivery remain separate.

The [October 14 rotated raster spacing correction](reviews/2026-10-14-rotated-raster-spacing/STATUS.md) retains full native column and row vector lengths. Six TIFF cases, intended source faults and independently decoded GDAL positions check the arithmetic. Survey accuracy, aerial delivery and complete M3/M5b.2/v1 acceptance remain open.

The [October 14 private raster inspection candidate](reviews/2026-10-14-private-raster-inspection/STATUS.md) binds declared native tag readings to original product bytes and code profiles. Source and selected-schema native controls preserve failed, unsupported, absent and unassessed outcomes. Ground quality, map placement, current-main installation, public delivery and full M3/M5b.2/v1 acceptance remain open.

The [October 14 private artifact preparation candidate](reviews/2026-10-14-private-artifact-preparation/STATUS.md) binds original job, actor, file bytes and native inspection receipts in one immutable private manifest. Exact interrupted replay and current access remain separate from callback delivery, map placement, processing quality and default-worker integration.

October 14 aerial Storage correction candidate: [immutable custody and transport
checks](reviews/2026-10-14-aerial-immutable-custody/STATUS.md) retain original
objects across interrupted row writes, reconcile actual streamed bytes, and
carry cancellation through the installed SDK upload transport. This isolated
candidate does not close source identity, concurrent custody, live RLS, browser
or complete delivery acceptance.

The [October 14 retained artifact access candidate](reviews/2026-10-14-artifact-access/STATUS.md) keeps original download leases and checks separate current delivery authority. Source, loopback and selected-schema SQL/HTTP fault controls pass. Both Python versions pass; intended-schema upgrade, default worker and visible delivery acceptance remain pending.

The [October 14 terminal journal candidate](reviews/2026-10-14-terminal-delivery/STATUS.md) preserves original terminal callback bytes and distinguishes historical receiver replies from current permission to send. A smaller replacement transport can read saved receipts but cannot start an unsendable POST. Source controls pass; both-interpreter regression, realistic native supersession and intended-schema restore checks continue. Default worker integration and complete M3/M5b.2 acceptance remain open.

The [October 14 retained artifact HTTP candidate](reviews/2026-10-14-artifact-http/STATUS.md) resolves original admissions from the private journal and binds response headers to the exact saved lease. It refuses ownership, authority, expiry or deadline changes during headers before releasing product bytes. Four 34-case cohorts on each interpreter detect 35 intended faults, including an actual non-reading client. Existing reader/admission regression passes on both interpreters. Native restored-schema HTTP cohorts and targeted SQL faults pass within the recorded fixture limits. The default worker does not enable the adapter.

The [October 14 original worker coordinator candidate](reviews/2026-10-14-worker-coordination/STATUS.md) connects committed original tasks to retained observations, products, leases and exact terminal delivery. Local errors preserve reported engine facts. Four 34-case cohorts on each interpreter detect 35 intended faults; restored-schema native callback/download recovery detects two SQL faults. Input preparation, engine commit, default activation and planner journeys remain open.

The [October 14 original input and commit candidate](reviews/2026-10-14-original-pipeline/STATUS.md) connects retained input drafts, one processing commit and original task delivery. Explicit recovery preserves the original started admission and releases its local hold only after acknowledged terminal delivery. Four 25-case cohorts on each interpreter detect 24 intended faults. Uncertain commits and older local outcomes without engine facts stay held. Native copied-journal recovery passes four three-case cohorts and two SQL faults within its fixture limits. Complete application receiver/Storage and default integration remain open.

The [October 14 combined original-worker candidate](reviews/2026-10-14-worker-stack/STATUS.md) joins the retained input, commit and delivery checkpoints with current main. It preserves the account-limit changes and checks the Storage fixture scope. Fresh combined CI and coordinated hosted migrations11/12 precede a dependent main merge. Default activation and acceptance remain open.

The [October 14 artifact root URL correction](reviews/2026-10-14-artifact-root-url/STATUS.md) rejects path prefixes the built-in server cannot serve. Both interpreters pass four 48-case source cohorts with 51 faults and four 34-case HTTP cohorts with 35 faults. Default integration remains open.

The [October 14 original running progress candidate](reviews/2026-10-14-running-progress/STATUS.md) retains one original running event before source work. Cached acknowledgement still requires current actor access. Four 36-case cohorts on each interpreter detect 32 intended faults. Native copied-journal recovery passes four four-case cohorts and two SQL faults within the recorded fixture limits. Independent review confirms three corrections. Default and complete application receiver/Storage integration remain open.

The [October 14 original outcome recovery candidate](reviews/2026-10-14-outcome-recovery/STATUS.md) preserves an older local failure and binds a separate receipt to acknowledged original delivery. Historical acknowledgement repairs bookkeeping without another POST; pending delivery requires current actor access and the saved command hash. Source and isolated native controls have separate records. Both interpreters pass four 31-case cohorts, 33 intended faults and 180 related cases. Four native four-case cohorts and two SQL faults have direct-ledger fixture limits. Configuration, default integration and full application receiver/Storage remain open.

The [October 14 original recovery scheduling candidate](reviews/2026-10-14-recovery-execution/STATUS.md) attempts old-outcome repair, held original recovery and new admission in that order. Each attempted stage ends the step. The lifetime owner and pinned adapter joins must remain unchanged. Both21-case source campaigns and120-case related suites pass; four native four-case cohorts and two SQL faults pass on the retained415 direct-ledger fixture. Configuration/default, full application receiver/Storage and broader acceptance remain open.

The [October 14 Node process observation candidate](reviews/2026-10-14-node-queue-observation/STATUS.md) wraps eight existing queue commands, preserves their shutdown ownership and exposes a private process-only census. Native role and blocked late-arrival controls have separate selected-fixture limits. Candidate migration 15, hosted rollout, business-worker and planner acceptance remain open.
