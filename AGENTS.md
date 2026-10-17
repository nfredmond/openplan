# Working on OpenPlan

This is the canonical repository operating entry point for Codex and Claude Code.
`CLAUDE.md` points here. Global harness preferences still apply; Nathaniel's current
request takes precedence. Do not duplicate this manual in harness files.

## Establish direction and ownership

The application package is `openplan/`; workers, scientific scripts, QA harness
and product documents are siblings at the repository root. Confirm checkout,
package, branch, working changes and active sessions before editing or testing.
Announce file ownership. Never change a checkout while another session is
collecting browser acceptance evidence. Use a separate checkout for independent
work and coordinate the join before updating main.

Before selecting a substantial lane, run `npm run product:direction:check` in
`openplan/`, then read:

1. [V1 contract](docs/product/V1_PRODUCT_CONTRACT.md): binding destination.
2. [Roadmap](docs/ROADMAP.md): the only active queue and milestone status;
   [milestone definitions](docs/product/MILESTONES.md) hold each Done line.
3. [Capability matrix](docs/product/US_PLANNING_CAPABILITY_MATRIX.md), latest
   [direction review](docs/reviews/product-direction/) and
   [known limitations](docs/ops/KNOWN_ISSUES.md).
4. [Architecture](docs/ARCHITECTURE.md), current code, tags, CI, relevant real
   journeys and dated scientific evidence.

If the check fails, investigate the actual reason. An expired or contradictory
review requires reassessment; changing its date or commit is not new evidence.
The [review protocol](docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md) guides
periodic and consequential scope reviews. Strategy age and intervening commits
are reminders, not release blockers. Use independent review where the decision
warrants it; do not require two whole-product reviews for every bounded change.
Preserve independent reports and disagreements. Prior agents' statements are claims to investigate.

## Product decisions

Keep the complete contract: core planning practice across all fifty states and
DC, California at the deepest implementation, explicit territory support,
tribal and overlapping authorities, coherent everyday workflows and independently
validated AequilibraE and ActivitySim for every published nationwide use.
No calendar, version count, runtime or effort constraint may quietly shrink v1.

Projects and statutory plans carry geography, evidence, people, artifacts and
decisions across modules. Deepen existing capabilities first. Check this repo,
Nathaniel's relevant older repositories and suitable free/open-source tools
before building. A new module requires a current whole-product review showing
that a core need has no coherent existing home; the module map cannot cap v1.

Geography, law and agency variation belong in sourced adapters/registries,
not hardcoded core types. Use the place resolver and existing geography APIs.
Study geometry, workspace home, jurisdiction and adopting authority are different
facts. Unsupported, unavailable, failed and unassessed must remain distinct from
zero. Worldwide extensibility remains an architecture requirement.

OpenPlan is free and open source, without a paid software tier or required paid service. Nathaniel may offer optional implementation, annual administration, customization and hosted evaluation. Preserve independent installation and customer data portability; these services do not authorize software entitlement gates. Research paid hosting when requested, but obtain concrete spend authorization before provisioning.
Do not restore subscription, Stripe or quota gates. Legitimate reimbursement
invoicing and AI spend protection remain. Do not remove historical schema merely
because its name sounds commercial. Check provider licenses and operating costs;
a provider's free tier is not proof of free agency operation.

Consequential facts, money, publication, legal applicability and adoption belong
to responsible humans. Agents may propose grounded changes; never fabricate data,
impersonate users, remove public caveats or silently promote a scientific claim.
Nathaniel owns outreach and product priorities. Engineering decisions belong to
the technical lead; request only the product judgments or authorization actually
missing from the current task.

The contract explicitly preserves full OWP/UPWP administration, complete RTP updates from the adopted predecessor, planning contract drawdown by task/employee/deliverable linked to forecast delivery, superior public engagement, API/installed CLI provider choice, full capital administration, local-tax/grant program administration with recipient reporting and measured project outputs, and complete consultant/agency procurement from discovery and solicitation through receipt, evaluation, award and contract handoff. Maintain their requirement-to-evidence mapping in `docs/product/CORE_REQUIREMENTS_LEDGER.md`; the roadmap stays the sole queue. These do not replace the remaining whole-product floor.

## Scientific custody and long work

Read the [modeling status](docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md),
[validation research](docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md)
and relevant frozen study before changing modeling. Dated statements that a
problem was closed do not override a new reproducible defect.

Keep AequilibraE and ActivitySim outputs separate; never average them. Compare
against the same geography, population, network, settings and evidence boundary.
Code computes numbers; language models narrate sourced facts. Model agreement
is sensitivity evidence, not accuracy.

Align observation year, period, units, direction, lane, vehicle and section.
Keep source-supported observation uncertainty separate from a preregistered,
use-specific acceptance tolerance. Grade observations and matches before viewing
residuals. Development, selection and untouched geographic acceptance sets stay
separate. Do not reopen consumed holdouts, alter immutable artifacts, widen gates,
drop difficult observations or fit scalars to make an exposed metric pass.
Inadequate evidence remains `inconclusive`; no national average rescues a failing
state, archetype, road class or declared use.

The historical 43.3% median APE is a one-county selection metric, not nationwide
or independent accuracy. The old 30% threshold is diagnostic, not the v1 gate.
Recheck the [engine landscape](docs/modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md) when
choosing methods. Accuracy can justify days of work; long jobs need resumable
workers, durable custody and interruption recovery, not serverless timeouts.

## Evidence and implementation

Prefer the smallest clear change. Read working designs before replacing them.
Use TypeScript/Node and Python; avoid `any` when a real type is available. A
comment explains use and intent above a function, not every statement.

Every changed test or guard needs a harmless mutation that survives and a
targeted broken behavior that fails for the stated reason. Restore edits without
`git checkout` or destructive resets in shared work. State each check's blind
category. Fix vacuous checks; never remove a failure to manufacture green.
Mocked database tests must assert query projections where correctness depends
on selected fields. Live RLS and recovery tests protect different boundaries.

A visible workflow requires an identified-build journey from real navigation,
desktop and 390px evidence, console review and usable artifacts. Green unit
tests, screenshots without provenance and server health do not establish that.
Use the local browser skill before opening OpenPlan; never interfere with another
session's browser, accounts or workers. Nathaniel's October 17, 2026 direction
makes agent-run planner and public-participant workflow checks valid acceptance
evidence for milestones and v1. Human feedback is post-v1, not a release gate.
Do not recruit reviewers or ask Nathaniel for human feedback. Label agent-run
results accurately and retain technical, scientific and workflow requirements.

Use the existing action registry for agent writes or record an executable
refusal. Preserve distinct authorship, exact approved-payload hashes, route-local
verification, audit, narrow scope and unchanged claim tiers. Start at
`openplan/src/lib/runtime/action-registry.ts`, `action-metadata.ts` beside it and
`openplan/src/lib/assistant/action-approval-server.ts`.
[ADR-004](docs/ADRs/ADR-004-mcp-server-surface.md) governs the future MCP server;
each underlying workflow must work before exposing its actions and remain usable without agent control. Nathaniel's September 4 direction makes provider choice for already-proven Planner Agent tasks an early priority, including installed Codex, Claude Code and OpenCode backends; it does not wait for all modules. See roadmap A0 and the dated T3 Code/provider review.

## Running and landing work

Use [Contributing](CONTRIBUTING.md) for contributor checks,
[Self hosting](openplan/docs/SELF_HOSTING.md) for configuration and
[Runbook](openplan/docs/ops/RUNBOOK.md) for operation. From `openplan/`:

```bash
npm run dev
npm run lint
npm test
npm run qa:gate
npm run test:rls-live
npm run test:workers
npm run product:direction:check
npm run product:direction:packet
npm exec -- supabase start
npm exec -- supabase migration up
```

Use npm; the build uses webpack. Live RLS tests write fixtures: use an isolated
test stack and opt in explicitly with `OPENPLAN_RLS_GATE=1` when running them
through QA. A running demo database is not a test target by default. Each worker suite uses its own environment.
Check disk before large models/downloads; ignored model records live under
`data/screening-runs/` and `data/_screening_cache/`. Never print secrets or commit
raw histories, client records or confidential acceptance captures.

Migrations are additive and data-safe. Ask before destructive operations,
database resets, killing others' processes, force pushes or paid infrastructure.
Self-service recovery must not depend on Nathaniel. Verify documented restore
procedures separately from representative database fixtures.

Follow the [development release policy](docs/product/DEVELOPMENT_RELEASE_POLICY.md).
OpenPlan had zero users as of September 7, 2026. Public signup opened on the hosted
installation on October 11, 2026; treat its accounts and workspaces as real user
data. Ship useful, honestly limited increments. The full twelve-journey assessment does not block every pre-v1 release;
retain its partial outcomes and require relevant evidence for each shipped claim.
Nathaniel authorizes hosted operation on October 10, 2026. The
[public cutover record](docs/ops/HOSTED_LIVE_2026-10-11.md) governs that installation's
dated evidence and limits. Local checks still govern local operation; paid hosting
is not a prerequisite for independently installed development releases.

### Live hosted installation, October 11, 2026

OpenPlan is live at **https://openplan-zeta.vercel.app**. The Nat Ford website's
`/openplan` and `/openplan/` paths redirect there, preserving query parameters.
That website has a separate repository and deployment; do not replace its homepage
or DNS to change OpenPlan. Public signup requires confirmation email.

- **Main is production.** Any commit that reaches `main` deploys: Vercel promotes
  it once the seven required checks pass, and Railway rebuilds each service whose
  watch paths it touches. A merge is a production deploy. Never merge or push to
  `main` while the coordination file below shows a hold.
- **Vercel:** the `openplan` project in the `natford` scope serves the web app.
  Check the actual Git source, production alias, `/api/health` and bounded
  runtime logs before declaring a deployment ready. A successful build can still
  be staged.
- **Supabase:** OpenPlan uses project `lolckycpdjsgeejsmuzl` for database, Auth and
  private Storage. It belongs to the Pro organization and uses Micro compute.
  The Nat Ford website uses a different project, `bymadqabjvtwrfbkcded`; keep them
  separate. The dated catch-up records 405 migrations. Git deploys do not apply
  migrations. The agent that owns a schema change coordinates its rollout with
  the other agents through the coordination file below; no separate approval
  from Nathaniel is needed. Record the planned migration there first, then work
  in this order: fresh database and Storage capture, apply the additive
  migration, confirm it, merge the code that depends on it, then check the
  route that uses it. Merging code before its migration breaks production.
- **Railway:** project `9d7fbdc3-c370-41b5-8471-34dc128e718e` runs application queues,
  separate AequilibraE/ActivitySim processing, and OCR. Main deployment triggers
  respect CI and service watch paths. An unchanged service can retain an older
  source commit; prove runtime-path equivalence instead of assuming drift.
- **Resend:** verified `natfordplanning.com` sends Auth confirmation/recovery and
  approved engagement email. Use the scoped sending credential already configured
  in the authorized services. Never print keys. Gmail's tested delivery lands in
  Spam despite passing SPF, DKIM and DMARC; do not promise inbox placement.
- **AI and cost:** only Nathaniel's synthetic hosted demo workspace has the
  encrypted Anthropic key and $5 monthly provider cap. Other workspaces supply
  their own keys. Never set `ANTHROPIC_API_KEY` or `OPENPLAN_SHARED_AI_KEY` on a
  hosted service: with public signup, a shared key bills every workspace. The
  additional operating authorization is $50/month beyond
  existing Vercel and Supabase subscriptions. Promotional credits do not change
  that budget or authorize shared paid AI. Managed GTFS admission remains disabled.

Read the [demo AI and schema catch-up](docs/ops/HOSTED_DEMO_AI_AND_GTFS_SCHEMA_2026-10-11.md),
[hosted recovery](openplan/docs/ops/HOSTED_RECOVERY.md),
[self-hosting](openplan/docs/SELF_HOSTING.md) and
[runbook](openplan/docs/ops/RUNBOOK.md) before operating this installation.
Nathaniel's October 12, 2026 direction: merge every verified pull request to `main`
autonomously, without waiting for his approval. Agents coordinate merges, holds
and migration rollouts with each other through
`$HOME/.local/state/openplan/COORDINATION.md`. Consult it before any merge or push
to `main` and honor any hold posted there. Keep your own lane's section current:
write it, amend it and delete stale lines rather than only appending. That file
is the only place a hold is posted; the untracked `COORDINATION.md` in the
canonical checkout is an older log. Verify live platform state rather than treating
these dated settings or a prior agent's report as current acceptance evidence.
The hosted relaunch does not establish complete v1 or scientific validation.
A daily encrypted offsite capture of the database and Storage runs on Railway
(`workers/hosted-backup/DEPLOY.md`); its first capture restores into a disposable
database. Captures are not atomic and do not include worker volumes; preserve the
documented recovery limits and protected key custody.

Keep one dependable main. Commit and push verified checkpoints to branches, land
them on `main` through pull requests, inspect GitHub CI separately, and preserve
unrelated work. A push is not a passing release.
Literal semver applies; user-visible capability generally bumps minor before v1.
Release commits align changelog, package version, migrations and release-ordering
checks; tag only when the declared evidence is satisfied. Documentation review
does not itself declare an unfinished development candidate released.

Keep expensive findings and unfinished boundaries in dated repository notes.
[Documentation index](docs/README.md) routes current authority. Preserve historical
studies, releases and decisions; archive or supersede old plans visibly instead
of rewriting what they found. Report errors and uncertainty promptly, in plain
language, with what changed, what was checked and what remains unproved.
