# PR330 promotion plan needs two bounded corrections

October 15, 2026. Independent source-only review. **No P1 finding; two P2 plan findings.** This review permits no hosted change, migration, merge, deployment or release. Existing holds remain.

## Review identity and ownership

The assigned checkout is `/home/nathaniel/.t3/worktrees/openplan/t3-386a55f0`, branch `t3/pr330-promotion-plan-independent-review`. It starts clean at `05dd3e8da4a4572437f06e771b0a2477873e681f`. A local fast-forward reaches `788547a105b215d2fa05934ff3ce4abed9b6affb`; no fetch occurs. Only this new directory belongs to this review.

The reviewed [plan](../2026-10-15-pr330-hosted-promotion-preparation/REPORT.md) and [source manifest](../2026-10-15-pr330-hosted-promotion-preparation/sources.json) pin source `43ae7e44ecec74eefadd14431822e0a521bbec24`. Its application tree is `bed283ab0c937ead65378a2e9d26c177ceee6938`. I read AGENTS.md and the planner-writing and prove-it skills. The current assignment controls authorization.

## P2: Do not extend the child's read prohibition to root

**Plan lines 35–39 and 65.** The last paragraph says read-only hosted inventory needs a new execution brief because this assignment forbids it. The reviewer's prohibition does not revoke root's existing authorization. The current review brief expressly allows root to perform fresh query-only hosted reads separately. Treating those reads as newly blocked adds an approval requirement and prevents the already-authorized next step.

State that root may conduct its authorized query-only inventory now. Keep explicit read-only transactions, target identification and protected handling. This child performs none of those reads. Hosted writes, migration application and provider changes remain unauthorized under the current brief. The correction does not invoke older autonomous operating instructions to permit them.

## P2: Separate migration admission from complete installation capture

**Plan lines 41–49, especially the unconditional worker-journal capture and “Without tested controls, retain the hold.”** The single required sequence makes installation-wide writer controls and capture of worker journals/WAL, artifacts and protected configuration prerequisites to these two database migrations. It also requires a separate 420 archive/object-byte restoration. That bundles wider recovery work into bounded promotion admission without identifying which additional components the chosen fallback actually needs.

Neither migration rewrites stored planning rows, Storage objects or worker journals. Migration 16 adds a nullable column, helper, CHECK and trigger. Migration 17 replaces two CHECKs and one function at the existing signature. Locking, CHECK validation, changed permissions and future write behavior still require evidence; “additive” does not prove compatibility.

Keep the fresh protected database and Storage capture required by [AGENTS.md](../../../AGENTS.md), lines 185–190, and [HOSTED_OPERATIONS](../../../openplan/docs/ops/HOSTED_OPERATIONS.md), lines 30–42. Identify relevant writers and in-flight work, establish the chosen capture's consistency, preserve required keys, and prove bounded upgrade/restore and rollback-reader behavior. Do not call a partial capture a complete installation recovery point.

Make any broader worker-volume capture or replacement-service rehearsal depend on the fallback selected and the rollout's actual affected services. The conditional Auth/Storage/credential/worker-replay sentence at plan line 49 is correct and should remain conditional. Full installation recovery stays unaccepted and owned by roadmap M3. [HOSTED_RECOVERY](../../../openplan/docs/ops/HOSTED_RECOVERY.md), lines 166–170, requires those wider checks before claiming complete installation recovery, not before every additive migration. The [release policy](../../../docs/product/DEVELOPMENT_RELEASE_POLICY.md), lines 13–24 and 78–86, requires relevant engineering and affected hosted workflows. This correction removes no demonstrated migration, data-safety or workflow blocker.

## Source conclusions and remaining limits

The SQL descriptions and rollback cautions are sound within their stated limits:

- Migration 16 grants helper execution to `authenticated` and `service_role`; its trigger rejects ordinary context writes, locks attributed writer membership with `FOR SHARE`, and stamps service writes. Trusted postgres INSERT preserves provenance/revision. The existing `set_projects_updated_at` trigger advances revision on UPDATE, including postgres UPDATE.
- Migration 17 preserves the nine-argument v2 signature and service-role execution grant. Its function diff moves classification validation to created rows and preserves skipped plan-type whitespace. Creation validation, source/hash custody and immutable audit triggers remain. Old-reader compatibility after new writes is not established by source alone.
- Schema before code, accepted schema retention during app rollback, compatible roll-forward when rollback is uncertain, and stopping after failed/lost migration acknowledgement are appropriate. Destructive restore requires separate authorization and reconciliation.

Local Git/blob inspection finds no discrepancy in the 43 recorded blob IDs, SHA-256 values or byte counts. Migration counts are 418/419/420. All 418 baseline files remain unchanged. Candidate adds exactly 16 and 17; intermediate `21510042e94bcaf80f262205ad156a7bb639e35c` adds only exact migration 16. These are source inventories, not installed histories.

The only application differences from frozen f0 are the report sentence and its existing test. There is no application difference between pinned source and the review base. This establishes source scope, not a new build. Frozen artifacts retain old wording. Desktop/390px raster acceptance remains incomplete, and the genuinely missing-column branch lacks actual transport proof. Earlier unexplained catalog differences remain unresolved; a later matching repeat does not erase them.

No live compatibility, restore readiness, current hosted state, CI result or workflow acceptance is established here. No tests, guards, mutations, compiler, build, dependency access, browser, database, service, network or provider operation runs. No operational or release hold is lifted. Independent installation remains separate from hosted-provider acceptance.
