# OpenPlan product and engineering review

Review opened 2026-09-04 against `ad640ce7164cbea55bddd30341748e5f48639410`.
This is an external working draft. The active development checkout remains owned by its release session. Final release state, later corrections, and the transition to repository documentation must be recorded before this becomes the current review.

OpenPlan has substantial working infrastructure for planning records, analysis, public engagement, funding, and governed evidence. Its main weakness is that the meaning of a planning job is not yet preserved through every handoff. A workspace's location can determine a client's legal checklist; a workbook round trip creates records rather than updating them; a successful export can omit linked map layers; and a live worker can be mistaken for an abandoned run. More pages will not resolve these problems.

The route to v1 is to finish real planning cases across the existing product, establish free and recoverable agency operation, and deepen geographic and scientific support alongside those cases. Both demand methods still need independent, use-specific nationwide validation. That program is mandatory, but it does not replace statutory planning, public participation, multimodal work, implementation, or usable operations.

## Evidence and review limits

This review separates inspected source, reproduced behavior, documentary claims, and engineering recommendations. A code path does not establish visible usability. A browser agent's completed task does not establish professional usefulness. A scientific artifact's valid hash does not establish model accuracy.

Initial inventory comprised 4,467 tracked files, 339 Markdown documents, 61 page files, 270 API routes, 242 migrations, 1,169 Vitest files, 51 worker test files, and 2,508 commits reachable from main. The page count includes redirects and public/authentication pages; it is not a count of distinct working planner capabilities. Inventory numbers are dated observations, not quality scores.

| Record set | Review performed | Limits |
|---|---|---|
| Product authorities | Read operating manual, v1 contract, complete roadmap, capability matrix/registry, direction protocol and latest direction record | Later development changes require reconciliation |
| Application and database | Inventoried all tracked pages/routes/migrations; traced representative geography, plan creation, export, permissions, evidence, worker lifecycle and public-data paths | Did not audit every route, SQL policy or migration for every role |
| Tests and operations | Read important CI/gate/worker/restore definitions; executed focused isolated guard tests and mutations; inspected remote CI and RLS results | No shared database fault injection, production restore, exhaustive mutation campaign or new browser journey during active acceptance |
| GitHub | Queried releases, tags, main Actions, all available PR metadata, open/closed issue lists, and review discussion on PRs 94, 98 and 99 | Those sampled PRs have no substantive review approvals; automated comments report review quota exhaustion. Classic protection requires strict `verify (qa gate)` checks; administrator enforcement is disabled and no PR review is required. Shuffled/RLS checks are not required merge contexts |
| Codex history | Inspected 100 session headers; 86 identified OpenPlan working directories. Read selected user/assistant records from the August 25 review and current development session, plus targeted contamination/transition records | Did not read every token, tool result or conversation in all sessions |
| Claude history | Inventoried 80 OpenPlan-related project directories containing 782 JSONL records, about 750 MB; sampled the August 25 independent review and retained browser evidence | Metadata inventory is not full content review; no unrelated personal history was reviewed |
| Acceptance records | Inventoried 50 first-week run manifests; sampled execution/outcome/build records, current-session explanations and retained screenshots | Did not rewrite original evidence or count partial/incomplete/contaminated runs as acceptance |
| Existing tools/repos | Inspected relevant OpenGeo, Aerial Intel Platform and City_Sim README/package/license records; checked established GIS/model/container/documentation sources. Later priority review inspected Relay Lab CLI adapter and pinned T3 native backend/auth/lifecycle source | No wholesale audit or source-code transfer from another project |
| Independent reviews | Two fresh-context reviewers reconstructed source independently before seeing each other's conclusions | Both were agents; neither is a practicing-user study or an independent human installation |

Raw session histories, credentials and unrelated personal records stay outside the repository. A manifest-inspection mistake exposed a disposable test-account credential in tool output; it was reported immediately and was not copied into review artifacts. The active account was not changed.

## Release and acceptance truth

At opening, main was clean at `ad640ce7`. The package and several current documents said 0.44.0, but the latest remote release tag was v0.43.0. GitHub's Releases endpoint returned no releases. Tags and GitHub Release objects are distinct records.

At `ad640ce7`, [CI run 33918931332](https://github.com/nfredmond/openplan/actions/runs/33918931332) failed while [RLS run 33918931224](https://github.com/nfredmond/openplan/actions/runs/33918931224) succeeded. The local direction check failed because the latest direction review still named v0.43.0. The shuffled suite also failed the copy/jargon ratchet and two scenario suites could not import a `server-only` dependency. A metadata fix alone is insufficient. A push is not a release or CI result.

| Acceptance record | Usable interpretation |
|---|---|
| `2026-09-01T03-36-34-705Z`, v0.43 source | Nine yes and three partly outcomes. Useful dated discovery; fails full outcome acceptance |
| `2026-09-01T11-06-18-597Z`, `b0e3efe1` | Records twelve yes outcomes, but predates stronger runtime-identity checks and subsequent consequential defects. Historical result, not current-candidate proof |
| Later September 1/2 runs | Include partial outcomes, turn limits, quota stops and missing terminal records. Preserve individual supported findings; do not combine them into one passing run |
| `2026-09-04T20-31-19-906Z`, `f0582670` | Development session explicitly reported that orphan job 02 continued after the checkout changed. That job cannot support acceptance |
| `2026-09-04T21-00-45-902Z`, `ad640ce7` | Single neutral-geography job records completion; retained desktop screenshots show the neutral legal disclaimer. It cannot establish all twelve jobs |
| `2026-09-04T21-16-15-287Z`, `ad640ce7` | Began as the current twelve-job run. It later exposed a crash-extract/scoring problem and the development session resumed corrections. Final disposition must come from its handoff |

The review did not touch development processes, worker jobs, browser sessions or test accounts. Source conclusions are bound to the inspected commit; fixes made later by the development session must be identified separately.

## Findings and consequences

### R1. Plan authority must belong to the plan

**Source-proven semantic defect, High.** `openplan/src/app/api/land-use-plans/route.ts` checks the selected legal descriptor against workspace home jurisdiction, then stores independently supplied authority text and geometry. A California client plan in an Oregon consultancy workspace is refused. Conversely, the same check does not establish that a plan drawn elsewhere inside a California workspace is governed by California law.

Keep workspace home as a convenient starting suggestion. Extend existing `PlaceOfRecord` and plan records to represent exact study geometry, sourced jurisdiction identities, adopting/reviewing authorities, applicable rule versions and the responsible human's applicability decision. A polygon alone cannot establish sovereign or statutory authority. Regional bodies, tribes and overlapping jurisdictions must not collapse into a single enclosing state.

Do not revert to offering every configured legal bundle without qualification. Prove both valid cross-client work and refusal of unsupported applicability. The current restriction prevents one misleading choice but uses the wrong authority boundary.

### R2. California general and specific plans require different rules

**Source and primary-law finding, High.** `openplan/src/lib/land-use-plans/registry.ts` offers general and specific plan kinds but shares the general-plan element checklist and amendment-frequency notice. The create route seeds descriptor requirements without plan-kind filtering. Government Code sections 65451 and 65453 establish distinct specific-plan content and amendment treatment. [California Legislature, specific plans](https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?article=8.&chapter=3.&division=1.&lawCode=GOV&part=&title=7.)

Separate rules by plan kind, jurisdiction, effective version and applicability. Review amendments and early public drafts as real jobs: a universally mandatory mapped designation may be a product choice, not a statutory prerequisite. A disclaimer cannot repair a wrong checklist. This review is evidence of the mismatch, not a legal-sufficiency certification of the replacement.

### R3. Free agency operation is not established by the setup guides

**Documentation contradiction, High.** README describes Docker Desktop as a free prerequisite for Windows/macOS users. Docker requires paid subscriptions for government entities. Vercel Hobby is restricted to non-commercial personal use and its once-daily cron limit cannot implement the repository's subdaily schedules. [Docker licensing](https://docs.docker.com/subscription/desktop-license/), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Linux Docker Engine, Node and self-hosted Supabase provide an existing engineering path. Do not claim that the current CLI stack is an agency production deployment: Supabase expressly describes it as development/testing infrastructure that must not be exposed externally. [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting).

Correct the guides now; complete the production reference deployment as roadmap work. Prove an independent operator, real authentication/email, scheduling, workers, upgrades and recovery. No paid service is authorized. Free software still consumes storage, electricity, bandwidth and operator time.

### R4. Local records still have external data flows

**Source-proven disclosure mismatch, High.** README's assertion that nothing is sent anywhere conflicts with maps, data retrieval and optional cloud AI. `workspace-gis/layer-placement-preview.tsx` puts an imported extent into a Mapbox Static Images URL. That sends the extent, not the entire imported file. No live confidential-data leak was reproduced by this review.

Document each outbound service, transmitted information, credentials, terms and failure behavior. Make agency-controlled egress and a local-capable cartography path a milestone. OpenGeo already uses MapLibre and PMTiles; inspect its approach without transferring AGPL code into Apache-licensed OpenPlan without license review. MapLibre does not by itself supply licensed offline tiles.

### R5. Long-running model work has an unresolved lifecycle mismatch

**Source-supported failure path, High; fault reproduction pending.** `run-liveness.ts`, `run-reconcile.ts`, `run-reaper.ts` and the reaping RPC use run/stage timestamps with a 45-minute silence threshold. ActivitySim can execute a long stage while a separate worker heartbeat remains fresh. The reaper does not consult that heartbeat. ActivitySim's status/artifact HTTP writes also need response checking and attempt-bound protection against late writes.

Distinguish healthy computation, progress, lost contact, cancellation and terminal failure. Prove long silence, process death, database outage, duplicate claims, restart and late completion in an isolated stack. Preserve exact input and output custody. Extending a timeout alone would leave the ownership problem unresolved.

### R6. Some handoffs preserve less than their names suggest

**Source-proven limits, Medium.** Portfolio import is deliberately create-only and does not restore all exported structured place fields. Direct project GeoPackage exports include project/corridors; governed bundles include additional approved evidence, but neither production builder call passes optional model-link or designation layers. The library support exists.

Retain conservative create-only behavior until reviewed reconciliation is designed. State the contract before download/import. Connect existing geometry support through one shared selected-evidence assembly path. Prove reuse in QGIS, an agency spreadsheet tool and a second OpenPlan context, including stable IDs, counts, CRS/axis order, units, source vintage, privacy and missing-layer states.

### R7. Acceptance gates protect important failures but leave evidence gaps

**Reproduced in isolated fixtures, High for release claims.** The first-week verifier accepted a synthetic completed/yes report with no browser directory. The direction checker accepted a cell promoted to proven without a dated evidence reference. Missing required states and expired registry reviews correctly failed. These are bounded weaknesses in otherwise useful checks, not grounds to discard the suite.

Maintenance in the isolated review copy adds browser-record completeness and dated, exact-byte evidence for proven cells. Neither mechanism can judge professional usefulness or prove that a report genuinely covers a state, role and practice. The final review must distinguish those implemented guards from the future relational coverage/acceptance system.

### R8. CI and recovery evidence do not cover every advertised layer

**Source-proven coverage gaps, High.** Main CI executes AequilibraE and modeling-script suites, but not the other four worker families' behavioral suites. Local import probes skip absent worker environments. `qa:gate` can skip live RLS when the local stack is unavailable, so the separate RLS workflow must be joined explicitly to release evidence.

The restore drill exercises selected database records and one storage object. It does not execute the documented full backup/archive mechanism or establish recovery of every `local://` model artifact. The walkthrough updater can warn and continue on unverifiable migration/build state. Preserve the useful existing drills while adding whole-record restore, complete worker execution and fail-closed deployment acceptance.

### R9. Diagnosed model defects must remain open

**Documentation status error.** KNOWN_ISSUES places unknown demand provenance and disconnected/unloaded network defects under closed items while its text says only diagnosis/disclosure shipped. Record disclosure fixed and diagnosis completed separately from corrected behavior and independent validation. Do not edit frozen studies to make their findings match a newer implementation.

The v0.44 published candidate remains `inconclusive`, did not advance overall, changed no default and opened no acceptance holdout. The published audit and comparison records for all fourteen county-method cases matched their declared bindings and summary fields in the scientific reviewer's checks. The independent verifier accepted the recorded source SHA and rejected an all-zero wrong SHA. That proves the checked custody relationships, not accuracy. Display-loader hash/summary enforcement still has latent gaps described in the scientific appendix.

### R10. Workspace isolation is not the whole agency information model

**Unproven workflow coverage.** RLS, restrictive grants, roles, public-data filtering and exact approvals are substantial foundations. This limited review found no new demonstrated cross-tenant exploit. It did not establish case-level confidentiality, tribal data sovereignty, records holds/disposition, outside-consultant access, or a complete records-request workflow.

Define and observe those actual jobs before adding a broad permission subsystem. Test confidential originals, approved public derivatives, revocation, staff turnover, attachments, exports, backups and service-role work. A public participant's receipt must identify what was actually stored and what remains pending moderation.

### R11. Accessibility and usefulness need evidence beyond agent success

**Unproven cross-cutting requirements.** Three retained desktop screenshots were inspected for legal disclosure, GeoPackage handoff and workbook review. They show a coherent navigation rail, explicit caveats and dense muted content; they do not prove measured contrast, keyboard completion, mobile reachability, screen-reader quality or external artifact usability. An older image named handoff-success still shows an unlocated project, illustrating why filenames and screenshots alone cannot certify the saved output.

Require complete desktop and 390px jobs, keyboard-only navigation, screen-reader tasks, zoom/reflow, non-map alternatives, printed/exported documents and slow-network recovery. Current DOJ guidance identifies WCAG 2.1 AA for state/local government web/mobile services; maintain a dated source instead of copying old compliance deadlines. [DOJ guidance](https://www.ada.gov/resources/small-entity-compliance-guide/).

Recruit practicing planners and public participants through Nathaniel. Observe their own real jobs and records with permission. Measure completion, errors, understanding and assistance. Simulated users remain regression/discovery tools.

### R12. Security maintenance and reporting need an owner

**Observed configuration/dependency gap, Moderate.** On September 4, the production dependency audit returned one moderate advisory for `@xmldom/xmldom@0.8.13`, reached through `mammoth@1.12.0`. GHSA-6gmq-8vp8-gcm6 concerns attacker-controlled entity-reference names during XML serialization; maintained 0.8.15 and 0.9.12 releases contain fixes. OpenPlan source and Mammoth's XML adapter use parsing; the sampled code has no affected `createEntityReference`/serializer call. Exploitability through OpenPlan was not established. The audit still fails and needs a reviewed lockfile update, not `npm audit fix` without inspection. [Upstream advisory](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6).

GitHub API checks show secret scanning and push protection enabled, Dependabot security updates disabled, and private vulnerability reporting disabled. The security policy offers a public contact-only fallback, but the advertised private-report path is unavailable. Classic main protection requires only the strict QA check and permits administrator bypass; no PR review is required. Enable a working private reporting route, establish dependency/release ownership and require the consequential CI contexts. These repository settings were inspected, not changed by this review.

### R13. Large transit ingestion remains tied to a web request

**Source-established resilience/performance risk, Medium; no new timeout reproduction.** GTFS catalog/URL, upload and refresh routes declare a 300-second ceiling and await the complete ingest. The shared pipeline retains version state and input custody, bounds retrieval, checks SSRF and reaps abandoned attempts; those are useful existing protections. It still parses and persists the feed inside the request rather than a resumable compute job. Source: `openplan/src/app/api/gtfs/feeds/route.ts:24-36,398`, upload route `54,217`, and `openplan/src/lib/gtfs/ingest.ts:392-562`.

Profile small/rural and large-agency feeds on the free reference installation, then move work that can exceed a minute into a durable worker using the existing version/adoption/custody sequence. Keep the currently adopted feed available until the replacement is accepted. Test interruption between object storage, parsing, partial row writes and promotion. A higher provider timeout is not durable resumption.

Other intake already has meaningful bounds: portfolio workbooks are limited to 10 MiB, 2,000 rows, 256 columns and bounded archive expansion. Those limits were inspected, not load-tested during this review. Document measured limits and rejection/recovery behavior, rather than promising unlimited agency scale from local unit tests.

## Whole-product capability assessment

No state or overall capability cell was promoted to proven. The current registry has 99 cells: 37 partial and 62 not-assessed. These dimensions are independent lists, not a complete practice-by-role-by-geography coverage model.

| Planning job and existing home | Present foundation | Required next proof |
|---|---|---|
| Onboarding, Workspace, Overview, My Work | Account/workspace creation, home geography, readiness and assignment links | Stranger setup, explicit map/data requirements, ordinary staff handoff, recoverable errors |
| Projects and work plans | Milestones, decisions, issues, risks, meetings, delivery/funding links | One durable case through multiple departments and staff changes |
| GIS and Data Hub | Spatial import, CRS handling, source records and layer versions | Complete selected-layer export, edited-layer version workflow, geography/units retention, large/invalid input recovery |
| Documents and Knowledge Base | Source documents, citations, extraction and OCR integration | Version identity, rights/retention, source reuse, accessible extracted/public documents |
| Corridor Analysis | Place selection, open-data metrics, explanations, GeoJSON | Source completeness, score meaning/normalization, reproducible comparisons and clear capped-data states |
| Models, county runs, Scenarios | Separate demand methods, assignment, run artifacts, saved comparisons, frozen diagnoses | Healthy long jobs; no mislabeled KPIs; validated uses, observations, behavior and network coverage |
| Safety | National fatality and selected deeper source adapters, screening, report linkage | Full injury coverage required by claimed use, consistent spatial scope, defensible denominators, safety-to-program decision |
| Generic Plans, Land Use Plans and RTP | Linked plan records; versioned statutory authoring/review/adoption; regional cycles | Clear ownership between three homes, correct plan-kind law, amendments, full plan production and implementation |
| Engagement and public portals | Maps, surveys, moderation, comments, public links and response records | Accessible resident receipt through response/disposition and an actual decision; representation and outreach limits |
| Transit, active transportation and freight | GTFS/accessibility, freight and multimodal model/data foundations | Service-day alternatives, operations/capital effects, network coverage and usable decision artifacts |
| Environmental, climate, resilience and equity | Templates, source/equity indicators and plan/project evidence | Alternatives, distributional effects, mitigation commitments, hazard baseline and monitoring through implementation |
| Grants, Programs, measures and Invoicing | Opportunity discovery, pursue/pass, awards, programming and reimbursement | Cost/price-year basis, authorization/obligation, amendment, delivery, claim and closeout without repeated entry |
| Reports and evidence packages | Grounded content, exports, immutable hashes, submit/return/approve | Recipient reuse, complete layer/document selection, accessible public derivative, semantic freshness |
| Development review | Existing project/plan/review primitives | Intake/completeness, parcel/policy applicability, findings, conditions, appeals and compliance. Establish product home before a new module |
| Aerial | Mission and processing/evidence interfaces | Reliable processing/recovery and interpretation in an actual planning job; use existing ODM integration |
| Assistant and agent controls | Grounding, action registry, named proposals, approval and refusal tests | Verify every consequential action and payload; early API/installed-CLI choice for proven tasks, then broader actions as ordinary workflows are proven |
| Operations and contributor experience | Local scripts, migrations, CI, monitoring, partial restore/upgrade drills | Supported free agency deployment, full recovery, all workers, incident ownership and independent contributor onboarding |

Compatibility redirects for Billing and Command Center already consolidate old navigation into Invoicing and Overview. Preserve them. Generated CRS registries are not refactoring targets merely because they are large. Concentrate maintainability work on defect-prone orchestration and duplicated evidence translation, particularly report generation, assistant context and the project/plan handoffs.

## Test and gate assessment

| Check | Classification and protection | Blind category / action |
|---|---|---|
| First-week execution/outcome/resume | Useful; partial, quota, timeout, missing selected jobs and fatal console errors fail | Missing positive browser records reproduced; narrow maintenance prepared. Human usefulness remains outside it |
| First-week finding corroboration | Useful but format-sensitive; rejects contradictions and unsupported screenshots/snapshots | Desktop minimum width excludes 390px findings from this format; pixel/semantic correctness needs direct review |
| Direction freshness/membership | Useful; missing state and expired registry mutants killed | Unsupported proven-cell promotion survived; exact evidence maintenance prepared. Metadata cannot establish independent thought |
| Live RLS catalog and cross-tenant/role probes | Useful and consequential | Hosted deployment, service-role side effects and case-level confidentiality need separate probes |
| Offline policy-source guard | Brittle; exact source strings can detect removal of known assertions | Contains a redundant Boolean tautology. Retire that assertion when maintaining the suite, preserving real catalog and migration tests |
| Copy/jargon ledger | Useful editorial budget, brittle exact counts | Current CI failure deserves judgment about actual user-facing wording, not automatic baseline inflation |
| Worker import check | Useful import smoke check | Missing venv means skip; does not execute worker behavior. Never label it all-worker coverage |
| Shuffled app suite | Useful for shared-state/order defects | Retain failing seed, distinguish compile/import errors and environmental failures from outcome tests |
| Published model verifier | Useful custody and conservation check; wrong source SHA fails | Does not prove accuracy; strengthen consistency with fields displayed by loaders |
| SQL custody and immutable approvals | Useful and necessary | Exercise omitted/NULL fields and service-role RPCs in isolated live tests; string presence is insufficient |
| Restore and upgrade drills | Useful representative regressions | Whole authoritative record, storage bytes, local model artifacts, concurrent work and actual documented procedure remain incomplete |
| Lint, types, build and dependency audit | Useful mechanical checks | No claim of workflow reachability, licensing eligibility, science or accessibility follows |

No failing test was removed to obtain green. No sealed scientific artifact, consumed holdout, model default or acceptance threshold was changed by this review.

## Decisions, sequencing and adoption

The independent product reviewer prioritizes correct plan authority and a reusable decision record. The engineering reviewer prioritizes free/private/recoverable agency operation. Both identify existing modules as the starting point and reject a model-only roadmap. The synthesis begins with truthful candidate/review evidence, then treats plan meaning, durable jobs and free operations as prerequisites to a complete agency case. Scientific development and nationwide source coverage continue as separate mandatory programs.

The detailed roadmap specifies outcomes, gaps, dependencies, definitions of done, verification, risk and cost. Its milestones are not a promised release count or a smaller destination. Environmental, development, transit, freight, housing and records work remain explicit pre-v1 obligations even where current implementation is unassessed.

Product decisions for Nathaniel concern territory depth, representative real planning cases, acceptable confidentiality/public-record policies, and which practitioners/public participants can be observed. Engineering choices such as schema shape, provider adapter, job fencing, test organization and installation topology remain the technical lead's responsibility.

Other adoption barriers to handle before v1 include maintainers and release signing, a private security-reporting path, source/license ownership and update cadences, public-record retention and portability, agency authentication and staff exit, accessibility procurement evidence, translation quality, low-connectivity operation, disaster recovery on a second physical device, and a support burden that a single founder or volunteer maintainer cannot carry indefinitely. Each needs an owner and executable evidence where possible. None is solved by another optimistic README claim.

## Changes versus future work

Review findings and recommendations above are not implemented product repairs. Only documentation consolidation and narrowly justified evidence-guard maintenance are authorized in this assignment. Active-development crash/scoring changes belong to that session. Before landing, list the exact guard changes, mutation results, documentation authorities, final HEAD/CI, and any pending human or operational proof here.

## September 4 priority addendum: engagement, local agents and capital delivery

Nathaniel's subsequent direction makes these early upgrades, while the active development checkout remains protected. This changes the proposed queue: M9/A0/M10 begin after their specific integrity/authority/role prerequisites, rather than waiting behind a long modeling sequence or every other module. The full US/California and scientific v1 obligations remain unchanged.

- **Engagement:** establish measurable advantages over a current Social Pinpoint implementation in participant task completion/comprehension, agency effort, accessibility, traceable decisions and export. Existing map/survey/moderation code is the starting point. First-party competitor documentation is not an observed usability comparison. See `ENGAGEMENT_PRIORITY_RESEARCH.md`.
- **Planner Agent:** current chat is Anthropic API-specific. Add user-selected APIs and installed Codex, Claude Code and OpenCode with native authentication. Theo's T3 Code is a source-verified implementation of this pattern; pinned source review finds substantial reusable lifecycle/protocol work, with editor-specific dependencies and a broader trust boundary than OpenPlan should adopt. Existing Relay Lab also supplies local invocation experience. See `PLANNER_AGENT_PROVIDER_RESEARCH.md` and `T3_CODE_REUSE_RESEARCH.md`.
- **Capital delivery:** extend Projects/Documents/stage gates/Invoicing from planning through environmental, ROW/utilities, PS&E, procurement, construction, payments/reimbursement, acceptance, closeout and asset handover. Support takeover of projects already under construction. Use actual administering/fiscal authority, funding and dated requirements; fixed statewide checklists would misapply changing Caltrans bulletins. See `CAPITAL_DELIVERY_PRIORITY_RESEARCH.md`.

One real local-agency capital project can connect all three: public input and agency responses inform alternatives; commitments enter the approved case; delivery and reimbursement retain that provenance; the selected agent helps draft and inspect without acquiring professional approval authority. This is a proposed first case, not fabricated acceptance data or a claim that one bridge proves all planning practice.

Research coverage expands to current provider official documentation, T3 pinned source, Relay Lab's existing CLI adapter, Social Pinpoint product/help/accessibility sources and Caltrans local-assistance sources. Detailed reports distinguish read/sampled/unavailable evidence. No provider login/model run, new browser journey, participant recruitment, payment or product implementation occurred in this priority review.

Correction during review: the proposed known-limit summary had retained older filtered-honeypot wording. Current `api/engage/[shareToken]/submit/route.ts` retains the contribution as a flagged moderation record and returns its saved ID. The draft was corrected from source; historical records and independent original reports were preserved.

Further source tracing for these priorities found concrete early defects: public feeds silently stop at 200 approved records and lose recent replies whose parent is outside the set; the contribution helper discards usable receipt metadata; and project-budget loaders silently cap financial inputs. Capital administration also needs a distinct accepted-closeout state that allows documented underspend, rather than treating the existing fully-spent check as complete closeout. These findings are not live-data incidents; the priority reports name bounded source evidence and required reproductions. Root independently checked the relevant public loader/grouping/receipt code, CA reimbursement descriptor, budget input types/caps, T3 permission/installed-binary seams and current Caltrans invoicing/bulletins.

## Restored core requirements: planning contracts and full RTP updates

Nathaniel reaffirmed budget drawdown by task, employee and deliverable against overall deadlines, with planning-practice project management, and complete RTP creation/update beginning with the prior adopted RTP. These are core scope. The dated requirements-recovery report finds direct August user decisions for full RTP elements/public review, chapter and figure import with citations, and PM/drawdown/invoicing. Exact older task/employee wording was not recovered in the bounded sample; the current explicit instruction independently establishes it. A roadmap omission was not a valid scope reduction.

The review now gives these dedicated M11/M12 outcomes and a requirement-to-evidence ledger. Extend existing Projects, engagements, staff/time, rates, delivery records and RTP/Documents rather than starting another PM or plan-authoring application. The contract for preparing an RTP and the RTP's regional transportation financial element are different budgets and must stay distinct.

New source findings at d2ce5c0f: project “actuals” mix outward client billing and recorded spend; NTE totals use net retained invoice amounts; time attribution checks workspace but not the engagement's project; time-to-invoice grouping loses automatic deliverable allocation; current rate loading omits effective dates. These prevent reliable task/staff cost and fee forecasts. Database-versus-API permissions and historical financial immutability require a deployed probe; no exploit or live financial loss is claimed. Root independently traced the retention, attribution, grouping and rate-loading seams.

The ordinary prior-plan reading action sends only the document ID. Its default extraction targets exclude chapter blocks even though a chapter-placement surface and documentation exist. Root traced both ends and the route default; no fresh browser journey was performed. The RTP-specific report supplies the full element/financial/publication assessment and applicability limits. Prior extraction guards against invention and source loss remain valuable and must survive repair.

Planning project controls should connect agreed scope, historical authorized budgets, actual effort/cost, remaining estimates, resource/dependency schedules, client/agency review windows, acceptance and changes. Spending percentage does not establish work accepted or a safe deadline. The core ledger explains proportional use of primary GAO cost/schedule guidance and the human cases needed to validate professional usefulness. No substantial product implementation was started during this review.

## Restored local tax and grant administration

Nathaniel's latest request adds explicit municipality self-service reporting of project statistics and expenditures to the already-required administering-agency workflow. Historical August user text directly requested this tax/sub-agency relationship and separately post-award grants administration. Current source has a meaningful Programs/local_measure foundation: receipts, effective allocation rules, recipient/claim records, MOE and public fiscal oversight. Preserve it and deepen the project/funding/report joins.

The scoped code review found missing recipient-user authorization and structured project/output reports. Workspace membership is broader than permission to submit one city's report. Claim approval and immutable-submission checks are stronger in the API than in tracked database INSERT/UPDATE policies; update-then-delete and concurrent status changes need adversarial probes. The form uses latest-period categories while its server correctly validates the selected period. Staff/public lifetime totals use single reads despite a configured 1,000-row API limit. These are source findings and proposed reproductions, not observed fraud, deployed leaks or browser acceptance.

Primary Napa research distinguishes Measure T and U, formula distributions, MOE and equivalent-funds obligations, and old/new tax periods. SFCTA's current sources identify the November 2022 Prop L successor to November 2003 Prop K, preserve outstanding obligations, and document sponsor reporting/closeout through a Portal. A historical Portal guide is not evidence of every current payment-intake channel. SHCC provides a network of administrators with different rules, not a statewide implementation template. Agency summaries can conflict with signed rules; the research retains discrepancies rather than silently choosing a convenient percentage or date.

Roadmap M13 and CORE-FUNDADMIN-01 preserve the connected outcome and its proof. Reported quantity, reviewed quantity, cash distribution and accepted project delivery remain distinct. Cross-program reuse must preserve actual award conditions; local-tax recipients do not automatically become federal subrecipients. The four dated local-measure reports state coverage and unverified questions. No product feature, live reporting cycle or regulatory certification was completed in this review.

## Restored procurement: consultant and agency workflows

Nathaniel expressly requires discovery, solicitation creation/publication, consultant responses, submission/receipt, evaluation, award and tracking from both sides. The current instruction binds this scope. The bounded history review found July 27 consultant proposal implementation and an earlier agency-procurement scaffold, but no exact older direct user request; it does not establish that the request was never made.

Current source at 27c22b68 has useful proposal preparation in the Grants workspace. Root traced shared pursuit context, templates, creation/update, section editing and export. Navigation omits procurement vocabulary; questions/format metadata is not exposed by the creator; issuer timezone is not recorded by deadline entry. Fixed seeded sections and a single combined export do not supply source-specific technical/fee packages. Exported attachment checklists do not contain the actual attachments. Unfinalized sections can lack a global draft stamp although body warnings remain. These are source findings, not observed missed submissions or live information leaks.

The inspected record model does not establish an agency competition with bidder isolation, protected receipt/opening, conflicts, evaluation, protest and award. M14 extends consultant work and introduces the missing agency case linked to Projects, Documents and M11/M10 delivery. Discovery starts with official-source/manual intake and maintained optional connectors; the current Grants.gov feed does not establish procurement coverage. OCDS is an interchange/publication reference, not the receiving/evaluation engine. No replacement ERP is justified by the reviewed evidence.

The agency research identifies funding/entity/service-dependent selection rules. Qualifications and price-inclusive cases need different controls; applicable concealed costs must remain protected through storage, search, extraction, exports and agent context. Root independently checked the Caltrans provisions and SAM discovery contract; the latter marks status filtering Coming Soon, so live support remains unverified. The four procurement reports retain sources and legal/history/runtime limits. No solicitation was published, no response submitted and no new product implementation or browser acceptance performed.

## Hosted trials and optional professional services

Nathaniel requires a mid-term hosted installation that works from another person's browser, supports real remote trials and provides a route to each customer's own installation. He intends to earn income from optional implementation, yearly administration and separately priced customization while OpenPlan remains free. This authorizes research and roadmap preparation, not paid provisioning. LICENSE-NOTICE already permits these services. The categorical future shared-worker ban and broad bans on service vocabulary are superseded by the current direction; preserve their history while revising current guidance and consequential guards. A service agreement must not become a software entitlement or disable a customer's installation when support ends.

The hosted preview needs production commissioning, actual mail/authentication, persistent artifacts, workers, schedules, trial isolation, cost controls and independent recovery. Current local Supabase configuration is for development; county model outputs depend on shared disk. The AI limiter deliberately allows requests when metering fails and cannot establish a global financial ceiling. The local refresh script warns and continues on uncertain migration/deployment identity. These source findings need meaningful guards before public operational reliance. A generic hosted web page and green health response do not establish the requested outcome.

M15 joins M3/M4/A0 and the existing whole-product cases: commission a representative release, observe remote end-to-end work, move a trial into a customer-owned deployment and prove that a second operator can administer it. Live demonstrations preserve scientific limitations and distinguish existing dated results from fresh execution. Plain-browser use cannot invoke a visitor's installed CLI without a separately authorized device connection. The primary cost and service reports document prices, assumptions, legal/operating boundaries and untested questions; no server was purchased or public instance commissioned here.

## Scope omissions found in this renewed draft

The follow-up scope audit found an error in this review's own consolidation: recovered comprehensive work-plan templates and the explicitly chosen full aerial/ODM lane lacked concrete roadmap outcomes. Grant discovery/application/calendar alerts, shared files, named legacy formats and daily-work choices were also too implicit. These now have stable core-requirement IDs and explicit M2a–c, M5a–b and M13e outcomes. M6a–c, M7 and M8 distinguish service planning, BCA/TDM, prioritization, full land-use/development and environmental/climate/Title VI cases. Shared proof retains localization/print/low-bandwidth use; small/rural and tribal cases are separate.

The dated scope reconciliation and three supporting audits distinguish direct recovered user instructions, current contract obligations and professional completion recommendations. The ledger's initial family/organization mapping remains open for practitioner/source expansion. Existing source foundations are not declared absent or complete. No live observations or application tests were run for these documentation changes. Historical review is sampled; not every old requirement can yet be certified recovered. Main still belongs to the active developer and final consolidation awaits the safe handoff.
