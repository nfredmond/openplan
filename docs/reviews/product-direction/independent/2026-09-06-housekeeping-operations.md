# Independent operations and product-direction review

Reviewed September 6, 2026. Source checkpoint `f563d40ca51f4efda88de19aeaa6e62475772a76`, repository `/home/nathaniel/code/openplan`, application package `openplan/`.

The new update coordinator has a real evidence-custody defect. It can successfully promote a candidate that omits files written by the running instance during preparation. The retained predecessor preserves those bytes, but the active application can no longer find them at their original paths. Fix this before presenting the desktop update as safe for an instance that owns mutable local artifacts.

This does not justify restarting the product roadmap. After the operational correction and the two already queued handoff reproductions, the highest-leverage product outcome remains an agency OWP prepared from its actual prior program, with staffing, funding, task ownership and recipient review joined through existing records.

## Independence and scope

I began with the supplied review packet, read repository AGENTS.md and the review protocol, and reconstructed the relevant implementation. I did not contact the other reviewer or read their conclusions. I read the contract and roadmap in the packet, then bounded current source sections of the roadmap, capability matrix, known issues, architecture, self-hosting/runbook, final first-week outcome record, and ActivitySim runtime record. Historical memory guided process-safety questions; current source supersedes its old defect claims.

All writes, fixtures and logs were confined to this report's directory through explicit paths and TMPDIR. Tests used fake service management and disposable local HTTP servers. I did not operate an installed demo, database, browser or existing process, and did not publish anything. Git status was clean before and after shell work. No live release/CI refresh or practitioner observation was performed.

`npm run product:direction:check` currently fails because the latest review predates the f563d40c implementation changes. This is the correct reason to conduct this fresh review; changing metadata alone would not resolve it. The packet reports package v0.44.0 with latest tag v0.43.0. That is packet evidence, not a live GitHub query. The dated final twelve-journey record has nine passes and three partial outcomes, with release withheld.

## Findings

### D1. High, reproduced: promotion can detach newly completed local artifacts

`openplan/scripts/ops/safe-refresh-walkthrough.py:137-144` copies the entire instance and then builds the candidate while the original remains active. Lines 151-157 detect tracked-source and `.env.local` changes only. Git explicitly ignores untracked files in that check. Lines 162-164 rename the original away and promote the older copy. Recovery at lines 105-108 similarly swaps entire trees without preserving mutable writes made since the retained predecessor was captured.

I reused the supplied integration fixture and inserted a real file write after `copytree` returned, before candidate preparation completed. The file represented a newly completed local run artifact at `data/screening-runs/new-run/output.json`. Update finished normally. The result was:

```text
phase: ready
active_artifact_exists: false
retained_artifact_exists: true
```

The reproduction is `probe_local_artifact.py`; its output is `probe-local-artifact.log`. The test used real local Git, real file moves and a disposable HTTP server. npm and systemctl were fixture implementations. This proves the file-transition defect, not that the installed demo currently stores this particular artifact there.

The affected deployment category is real in the architecture. `openplan/src/app/api/county-runs/[countyRunId]/validate/route.ts:19`, its refresh route, and the scaffold route resolve relative paths against the repository. `openplan/src/lib/models/artifact-source.ts` supports scoped local filesystem references. `docs/ARCHITECTURE.md:89-93` explicitly includes local model and imagery bytes in authoritative recovery state. A database can retain a successful artifact reference while the update displaces the bytes it names. This is unavailable active data, not proven permanent deletion.

Keep mutable data outside replaceable code releases, with a stable configured storage root. For an existing installation that mixes code and data, refuse promotion until writers and exact paths are accounted for, or perform a controlled reconciliation. Do not silently follow and snapshot a shared mutable-data symlink into a release directory; current `symlinks=False` also makes that configuration worth testing. A blanket extra Git cleanliness check does not protect ignored model data or writes arriving after that check.

The regression must complete a durable write during preparation, retain the database/reference identity, promote, and read identical bytes through the same active application path. It must also write after promotion and repeat manual recovery. Include new, changed and removed files. A no-write control should still update successfully. This recommendation would be falsified for a particular deployment by verified configuration proving all authoritative mutable paths are outside the replaced tree and remain bound to the same storage across both transitions.

### U1. Recovery claim is narrower than computer-crash durability

The ten supplied recovery cases exercise normal update/manual recovery, build failure, restart failure, target refusal, settings conflict, backup identity, an already constructed missing-instance state and concurrent locking. They do not abruptly terminate an updater at every persistent transition, exercise machine power loss, or fail a second recovery restart.

`save()` fsyncs the journal file and the state directory. The subsequent cross-directory renames do not explicitly fsync the instance parent and transaction directory. I did not prove a particular filesystem loses those renames, so this is an unresolved durability boundary rather than a reproduced loss claim. The evidence supports recovery from the staged interrupted state exercised by the fixture. It does not yet establish a crash-durable installation update.

Add interruption exercises at both promotion renames, both recovery renames, restart completion and journal completion, on a disposable target. Separate process interruption from power-loss durability. Verify directory and payload durability deliberately before promising the latter. Preserve the current warning that the tool does not recover the database.

### U2. Native layout and owned-process checks do not establish complete accessibility or shutdown

The current native layout test checks output height, widget bounds, wrapping, focus visibility and reachability at two window sizes and two scales. It does not establish screen-reader semantics, contrast, action comprehension, an actual error-sharing task, or a complete application update from the installed icon. The existing screenshots and verification record remain dated evidence; I did not independently view a running GUI.

The process code pins PID handles and revalidates session identities, which addresses the earlier foreign-process hazard. `stop_owned_session()` returns after sending TERM. The normal Stop button honestly says a stop was requested. The close dialog immediately destroys the window after the same return. Its stronger "Stop it and close" interaction does not check that every owned listener exited. A child that ignores TERM or appears after the inventory remains an untested boundary. Do not weaken identity checks to fix it; add an owned-process completion check and an explicit incomplete-stop result.

### U3. CI runs useful bounded checks, not the complete operational proof

`.github/workflows/ci.yml` now runs the ops scripts, native layout checks on a private display, and controller/recovery mutations. Its ops floor is only one suite although five exist. The explicit mutation step protects two suite paths, but the process suite can disappear without that floor noticing. Raise the inventory protection or explicitly assert the required suite families. A suite file being executed also cannot prove its tests were collected; retain actual test-count evidence where appropriate.

The modeling and worker jobs remain lightweight unit environments. The worker job shown here is AequilibraE-worker focused. These jobs cannot establish two real demand engines, complete agency operation or independent restore. The separate required workflows and live worker acceptance must remain named in release evidence.

The old `test_automated_checks.py` tests `check_status.summarize_check_conclusions`, while the current panel has separate exact-commit logic. It is useful legacy helper coverage, not evidence about the current network query. The current controller tests do exercise that query and reject running or wrong-commit evidence. Keep that distinction explicit rather than counting both as redundant proof.

## Verification and blind categories

I applied the prove-it skill and ran both supplied mutation harnesses with temporary files confined to this directory. The controller harness returned zero: its harmless comment survived and seventeen targeted changes were killed. The recovery harness returned zero: its harmless comment survived and eight targeted changes were killed. Failure traces name the expected affected assertions, including missing rollback, accepted wrong target, settings conflict and ignored lock. The harmless runs also execute the complete corresponding baseline suites. Logs are `controller-mutations.log` and `safe-refresh-mutations.log`.

These are meaningful checks of their named boundaries. Their blind category is an independently changing mutable artifact tree and actual production runtime/database behavior. D1 reproduces within that blind category while the supplied tests remain green. I did not run a new native GUI test, a full app suite, real worker computation, migration, browser campaign or remote CI. None is implied by this report.

## Ten product-direction answers

1. **What makes this the ultimate free planning operating system?** An agency can preserve one authoritative case from source intake through analysis, consultation, responsible approval, delivery, amendments and public records. Another planner can continue it, and another administrator can recover it without Nathaniel. Independent installation and complete usable exports are part of the product. The current contract describes the right destination; the recovery defect illustrates why custody must follow ordinary changes as well as scientific studies.

2. **Can every type of US planner do core work here?** No complete proof supports that. The capability matrix records partial transportation, land-use, environmental, engagement, capital and GIS foundations, with development review and several organization contexts unassessed. OWP administration, prior-adopted RTP updates, employee/task/contract budgets, procurement, grant and municipal reporting, statutory hearings and ongoing environmental/civil-rights obligations need complete cases. Rural, tribal, nonprofit and small-office use also need real installation, connectivity, accessibility, permissions and recipient evidence. These jobs largely belong in existing modules and shared records; an additional navigation module is not the remedy.

3. **Does every state work substantively?** No. The current matrix says California is partial and the other fifty state/DC entries are unassessed against the whole contract. Three readiness exemplars and selected manual reconnaissance do not establish complete support. Preserve territory policy and tribal/overlapping authority separately. This answer follows the current ledger; I did not conduct fifty-one fresh legal reviews.

4. **Is California the gold standard?** Not yet. The roadmap still names case authority independent of workspace home and separate general/specific-plan applicability as open work. Full OWP/RTP, capital delivery, rural/mountain/coastal/border and tribal cases need observed outcomes. A repaired land-use save interaction and deep manual inventory cannot establish statewide professional completeness.

5. **Are both travel models validated for every published use and state?** No. The current first-week and science records preserve inconclusive results; the ActivitySim runtime document explicitly separates obtaining a trip list from transferable behavior. AequilibraE and ActivitySim must retain independent outputs and acceptance evidence. Do not reuse consumed holdouts or promote model agreement into accuracy. Operational recovery must preserve the exact inputs, claims and receipts across interruptions.

6. **What simple overlooked idea has the largest effect?** Give each actual planning case one visible next responsibility and one durable recipient handoff, including incomplete work and artifact availability. Existing My Work, Projects, Programs and Documents can own this. Add operational custody to the same completion record so "finished" means the next person can open and use the output after an update. The already queued undated-action and shared-campaign handoff checks are good immediate probes.

7. **Which old rule or decision is wrong?** Treating a clean source tree plus matching commit as a safe update boundary is insufficient when ignored local data lives under that tree. Treating all default CI as complete operational proof is also wrong. The absolute old prohibition on new modules has already been replaced appropriately by evidence-based reuse in current AGENTS.md. Keep the full v1 destination and avoid reviving historical backlog order. The low-level shell builder still updates in place and must remain an explicitly limited preparation tool or be refused as a direct operator path.

8. **What should be joined or deepened first?** Join planning-program work elements to existing tasks, people, contracts, funding, actual work and approved deliverables. Join public contributions and implementation actions to the same case/recipient evidence. Deepen stable storage, backup/restore, approvals and installation alongside those cases. Reuse the control panel and workers; do not create a second orchestration system or remove existing practice obligations to make acceptance easier.

9. **What evidence would prove these recommendations wrong?** A current-build stranger/recipient journey demonstrating these handoffs already work would replace source-gap hypotheses with bounded accepted behavior. A permitted OWP task showing a different missing dependency dominates the planner's work would change sequencing. A correctly scoped configuration inventory plus concurrent-write update/recovery tests would settle D1 for the target deployment. Full separate-host restore with exact local/object bytes and continued authorized work would close the operations gap. Independent state/use-specific validation could close scientific cells. A green unit suite alone falsifies none of these product recommendations.

10. **What is the highest-leverage next completed outcome?** Close the bounded update-custody defect before using the new updater on mutable instances, complete the two queued handoff reproductions, then deliver M2d.1: an agency planner imports its previous OWP, reviews source-derived work elements, assigns real people/funding and hands a saved program to a second authorized reviewer with usable source-linked artifacts. Include interruption/resume and artifact preservation in that case. Continue engagement, provider choice, capital, contract/RTP and scientific priorities as the roadmap states; one OWP increment cannot substitute for the full contract.

## Recommendation boundary

I recommend accepting the checkpoint as useful source and isolated-test progress, with D1 recorded and corrected before live mutable-instance promotion. I do not recommend declaring M3a, complete demo acceptance, v0.44 release, nationwide support or scientific validation complete. Existing native layout evidence may stand within its named sizes/scales. Current independent findings should be preserved unchanged and synthesized with the other report only after both are finished.


## Post-review response to the lead's proposed correction

After the independent findings above were written, the lead proposed keeping the instance root and all untracked/ignored durable data in place, while replacing only tracked source, `.next`, `node_modules`, and the stamped environment file. The proposal retains previous versions and uses an operation journal plus explicit Git metadata updates. This section assesses that proposal; it is not evidence that a correction exists or works.

The approach directly addresses the demonstrated whole-tree displacement, provided a selected parent directory never contains authoritative mutable data. It can reuse the coordinator without introducing another service framework. Immutable code directories with externally rooted mutable data remain the cleaner eventual installation design, but a selective transition can be a bounded migration step.

Require these conditions before accepting that implementation:

- Prevent the verified service from serving a mixture of old source, new `.next` and intermediate dependencies. Prepare while it runs, then quiesce the explicitly owned target for the short installation interval. A failed promotion must recover before serving again. Source/health identity alone does not quiesce external writers; preserve their stable data paths.
- Compute explicit old/new tracked path inventories. Handle deletions, renames, executable modes and symlinks. Refuse a newly tracked file that collides with an existing untracked or ignored path, including a symlink ancestor. A file being tracked by the new commit does not authorize overwriting existing agency data. Git may treat ignored-file collisions differently from untracked files, so test both.
- Journal each path transition before mutation, preserve prior bytes and restore only transaction-owned changes. Recovery after partial rollback must remain repeatable. Never remove a new path during rollback if its bytes or ownership changed after installation. Do not replace a directory merely because it contains a tracked child.
- Bind Git HEAD/index updates to fully installed source and restore them with the same transaction. Exercise interruption before and after metadata writes. A changed HEAD cannot become a readiness signal while source files remain mixed.
- Preserve environment ownership and concurrent configuration changes. An `.env.local` symlink into managed secret storage should be handled deliberately or refused, not silently converted into a copied regular file. Stamping the commit must not overwrite unrelated settings changed during preparation or after promotion.
- Complete concurrent artifact-write tests for both update and later recovery, including modified, new and deleted files. Verify active reference paths and exact bytes, not only files retained somewhere in the transaction directory. Test an interrupted promotion, interrupted recovery, a restart timeout, and a second attempt after each.
- Keep the already disclosed runtime-database and accepted-release selection boundaries open. Selective source replacement does not establish either. Measure retained dependencies/builds and disk growth; a safe path transition can still exhaust the computer's only disk.

This review does not authorize a live service update or promote the original f563d40c evidence. A correction needs its own commit-bound source review, harmless/targeted mutations and isolated transition proof before the lead considers the installed desktop workflow.
