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
2. [Roadmap](docs/ROADMAP.md): the only active queue and milestone definitions.
3. [Capability matrix](docs/product/US_PLANNING_CAPABILITY_MATRIX.md), latest
   [direction review](docs/reviews/product-direction/) and
   [known limitations](docs/ops/KNOWN_ISSUES.md).
4. [Architecture](docs/ARCHITECTURE.md), current code, tags, CI, relevant real
   journeys and dated scientific evidence.

If the check fails, investigate the actual reason. An expired or contradictory
review requires reassessment; changing its date or commit is not new evidence.
The [review protocol](docs/product/PRODUCT_DIRECTION_REVIEW_PROTOCOL.md) requires
at least two independent fresh-context reviews monthly, at milestones and when
a materially stronger model becomes available. Preserve independent reports and
disagreements. Prior agents' statements are claims to investigate.

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
session's browser, accounts or workers. Agent journeys do not replace observation
with practicing planners and public participants.

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

Use npm; the build uses webpack. Each worker suite uses its own environment.
Check disk before large models/downloads; ignored model records live under
`data/screening-runs/` and `data/_screening_cache/`. Never print secrets or commit
raw histories, client records or confidential acceptance captures.

Migrations are additive and data-safe. Ask before destructive operations,
database resets, killing others' processes, force pushes or paid infrastructure.
Self-service recovery must not depend on Nathaniel. Verify documented restore
procedures separately from representative database fixtures.

Keep one dependable main. Commit and push verified checkpoints, inspect GitHub
CI separately, and preserve unrelated work. A push is not a passing release.
Literal semver applies; user-visible capability generally bumps minor before v1.
Release commits align changelog, package version, migrations and release-ordering
checks; tag only when the declared evidence is satisfied. Documentation review
does not itself declare an unfinished development candidate released.

Keep expensive findings and unfinished boundaries in dated repository notes.
[Documentation index](docs/README.md) routes current authority. Preserve historical
studies, releases and decisions; archive or supersede old plans visibly instead
of rewriting what they found. Report errors and uncertainty promptly, in plain
language, with what changed, what was checked and what remains unproved.
