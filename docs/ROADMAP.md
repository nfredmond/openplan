# OpenPlan development roadmap

<!-- openplan-active-roadmap
reviewed_commit: 391eed25
current_release: v0.34.0
review_by: 2026-09-22
paths:
- openplan/src/lib/safety/sources/registry.ts
- openplan/src/lib/safety/sources/fars.ts
- openplan/src/lib/auth/role-matrix.ts
- openplan/src/lib/export/csv.ts
- openplan/src/lib/grants/programs/registry.ts
- openplan/src/lib/stage-gates/template-registry.ts
- openplan/src/lib/land-use-plans/registry.ts
- openplan/src/lib/runtime/action-metadata.ts
- docs/ops/KNOWN_ISSUES.md
- openplan/docs/ops/BACKUP_AND_RESTORE.md
- docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md
- docs/ADRs/ADR-004-mcp-server-surface.md
- qa-harness/FIRST-WEEK-HARNESS.md
npm_commands:
- ops:restore-drill
- test:workers
- test:rls-live
- qa:gate
-->

This is OpenPlan's only active development queue. Dated records, research,
release evidence, ADRs, and archived plans explain past decisions; they are not
queues. `CHANGELOG.md` records what shipped. Reconcile this file against the
repository by the review date above.

Rewritten 2026-08-25 after reviewing the repository, live product, releases,
first-week evidence, agent histories, memories, and documentation at v0.34.0.
The previous roadmap described safe release mechanics but not the finished
product. This roadmap starts with the product destination.

## The v1 product contract

**A planning team anywhere in the United States can install and operate
OpenPlan without Nathaniel, carry source material through analysis and public
process to a defensible decision artifact, and know exactly what the evidence
does and does not support.**

Five tests make that contract falsifiable:

1. **Self-service.** A new operator can install, configure, back up, restore,
   and upgrade the system without founder help or paid infrastructure.
2. **One product.** Projects and plans are the spine. Analysis, engagement,
   funding, documents, and reports reuse their context instead of behaving like
   separate applications.
3. **Any place.** Every workflow works with a user-selected US geography today.
   A limited data or legal source identifies its boundary where the result is
   read. Country-specific concepts remain behind adapters and registries.
4. **End-to-end outcomes.** A journey is complete only when the planner reaches
   the intended outcome and obtains a usable artifact. A script finishing with
   `partly` is not evidence that the outcome works.
5. **Defensible handoff.** Every consequential figure and decision carries its
   source, retrieval date, claim tier, known limits, responsible human, and
   frozen evidence where required. Missing evidence fails closed.

The release-engineering gate remains mandatory: worker integrity, restore and
upgrade rehearsals, mutation evidence, live RLS, production build, and CI on
one candidate commit.

## The product at v1

A planner starts with a project or statutory plan, not a module. The work then
flows through one shared record:

```text
source data and documents
          ↓
project or plan record + selected geography
          ↓
analysis ↔ engagement ↔ funding and delivery
          ↓
review, approval, and frozen evidence
          ↓
report, packet, GIS/workbook export, or adopted decision
```

Top-level navigation should reflect jobs a planner recognizes. A surface either
participates in a proven workflow or leaves the top level. Existing capabilities
remain available; v1 does not require deleting useful specialist tools.

## Evidence at the starting line

Measured at v0.34.0:

- 60 planner-facing pages, 256 API routes, 223 migrations, and 5 Python workers.
- 12,515 passing unit tests, 107 live RLS tests, 47 passing worker suites, a
  production build, restore drill, and upgrade-path CI.
- 12 registered assistant actions and executable refusals for unsafe write
  shapes.
- All seven automated first-week jobs can finish, but the latest evidence still
  records partly reached outcomes. The safety journey lacks street identity for
  KSI locations, and the printable packet lacks a usable street background.
- Live review found 20 authenticated destinations arranged as module groups,
  duplicate local and global navigation, repeated primary actions, large card
  grids, and owner diagnostics mixed into the planner's first screen.
- FARS is explicitly fatal-only. The live safety workspace, corridor evidence,
  and exports disclose that serious-injury data is unavailable rather than
  silently treating injuries as zero. Broader injury coverage is valuable, but
  the claimed missing disclosure is not a current defect.

The main v1 gap is coherence and completed user outcomes, not missing breadth.

## Twelve v1 acceptance journeys

Each journey starts from visible navigation in a fresh or documented state,
uses real application behavior, and ends with an outcome verdict: `reached`,
`partly reached`, `blocked`, or `failed`. Only `reached` passes the v1 gate.

1. **Install and first day:** install locally, create a workspace, invite a
   colleague, configure a source, run a backup, restore it, and see what needs
   attention.
2. **Neutral geography:** select a place outside California and see honest data,
   legal, and source coverage at every result boundary.
3. **Project intake to decision packet:** import or create projects, resolve
   conflicts, prioritize one, carry it through review, and export a usable
   packet with street/place identity.
4. **Engagement:** build, preview, publish, moderate, analyze, export, and close a
   campaign without re-entering project or geography context.
5. **Safety:** move from crashes to KSI locations, countermeasures, cost, grant
   evidence, and a printable map-backed packet.
6. **Corridor analysis:** select a corridor, combine counts, safety, equity,
   engagement, and model evidence, then export a GIS-readable package.
7. **Dual demand model:** run AequilibraE and ActivitySim on the same network,
   inspect agreement and divergence without averaging, and produce a grounded
   report artifact.
8. **RTP:** build the project list, fiscal constraint, measures, required
   elements, public draft, comments and responses, and adoption record.
9. **Land-use plan:** configure the applicable legal bundle, review exact
   evidence, map designations, publish review, and record human adoption.
10. **Grant to reimbursement:** match a defensible project to a program, prepare
    an application, manage award and obligations, then invoice the funder.
11. **Aerial evidence:** plan a flight, upload imagery, run the local worker,
    review the orthophoto, select evidence, and freeze it into a report.
12. **Team and recovery:** exercise roles and approvals, My Work, audit history,
    worker interruption/recovery, backup, restore, and upgrade.

## v0.35: make it feel like one product

This is the first release because live review showed that OpenPlan's capable
modules still make the planner assemble the workflow mentally.

- Make Projects and Plans the durable context spine. Preserve active workspace,
  project, plan, geography, and reporting period across module transitions.
- Replace the duplicated secondary navigation on authenticated pages with one
  consistent orientation pattern.
- Present Models, Scenarios, and Model Validation as stages of one guided model
  workspace while preserving stable URLs and specialist entry points.
- Reduce above-the-fold setup prose, repeated hero actions, and card grids.
  Prefer a clear next action, compact status, and progressive detail.
- Move operator diagnostics and environment setup out of the planner's daily
  overview while keeping them easy for the operator to reach.
- Fix first-week continuity defects: active-workspace loss, reminder and task
  discoverability, project intake handoff, corridor entry, road-name identity,
  and printable street context.
- Change the first-week gate so completed automation cannot pass when the
  intended outcome is only partly reached.

**Done when:** a fresh user completes the project, engagement, safety, and
corridor journeys without choosing between duplicate controls or re-entering
known context, and every journey records `reached`.

## v0.36: prove the any-place promise

- Audit all top-level workflows with one California geography and at least one
  neutral geography outside every configured legal bundle.
- Put coverage boundaries beside the affected map, table, figure, and export.
  Do not rely on a setup page or distant caveat.
- Research open, stable, and legally usable serious-injury sources. Extend the
  crash-source registry when evidence supports an adapter; retain explicit
  fatal-only behavior where it does not.
- Add an optional geocoding adapter for road and place identity with provenance
  and a clear unavailable state. No silent commercial dependency.
- Give printable maps a legible street background that works through the local,
  free-first deployment path.
- Add first-week journeys that fail on a hardcoded jurisdiction, silent empty
  result, or undisclosed coverage ceiling.

**Done when:** the neutral-geography journey reaches a defensible artifact, and
mutations removing coverage disclosure or inserting a fixed place fail.

## v0.37: complete the inbound and outbound loop

- Export GeoPackage for study areas, corridors, crash locations, modeled links,
  engagement pins, and land-use designations so both ArcGIS and QGIS can use the
  work.
- Export XLSX that mirrors portfolio workbook import and preserves explicit row
  decisions and provenance.
- Produce a per-project evidence bundle with a machine-readable manifest of
  source, retrieval date, claim tier, custody hash, and known limits.
- Make imported documents and frozen artifacts discoverable from the project or
  plan that uses them.

**Done when:** a planner can round-trip a portfolio, open a corridor package in
QGIS, and identify the evidence behind each consequential attribute without
opening OpenPlan.

## v0.38: make teams and approvals real

- Extend the role matrix to every consequential write surface. A new uncovered
  surface must fail an executable guard.
- Record named human approval and time for adoption, public release, stage-gate
  decisions, funding obligations, and other consequential actions, beside the
  existing exact-hash evidence.
- Make My Work the shared inbox for assignments, reviews, approvals, worker
  exceptions, and incomplete journey handoffs.
- Remove remaining routes that infer the active workspace when the user has
  already selected one.

**Done when:** analyst, approver, and viewer roles complete the team journey;
unauthorized controls are absent; and the final record identifies the human who
approved the exact artifact.

## v0.39: finish the evidence loop

- Show per-link model state wherever a volume appears: modeled, unloaded, or
  outside the network. Never render an unloaded link as a measured zero.
- Carry measured model limits and source provenance into corridor, report, GIS,
  and grant artifacts.
- Make the complete common-network AequilibraE and ActivitySim comparison
  reachable as one journey. Preserve divergence and never average the methods.
- Connect engagement observations to safety evidence as corroboration without
  converting resident reports into crash facts.
- Prefer relative with-project and without-project comparisons where they are
  more defensible than absolute screening volumes.

**Done when:** the dual-model and corridor journeys reach frozen, grounded
artifacts and no surface can display a modeled value without its evidence state.

## v0.40: run the stranger test

- Run all twelve acceptance journeys against one release candidate. Zero
  `partly reached`, `blocked`, or `failed` outcomes.
- Have a person who is not Nathaniel install OpenPlan on a clean computer from
  the public documentation and complete the project journey without help.
- Complete keyboard, screen-reader, responsive-layout, contrast, and print
  checks on every step used by the twelve journeys.
- Rehearse backup, restore, migration, worker interruption, and rollback on the
  same candidate commit.
- Pass `qa:gate`, live RLS, all worker suites, mutation samples, production
  build, and CI. Resolve every undisclosed Blocker or High known issue.

**Done when:** the stranger and automated evidence agree that the v1 contract
is true. Then tag v1.0.0; do not reserve another capability release by habit.

## Deliberately after v1

- A nationwide fitted scalar or another attempt to hide the model's residual.
  Held-out evidence, not a better-looking aggregate, must justify any default.
- Crash rates per modeled VMT until road coverage supports the denominator.
- Additional legal bundles without researched jurisdiction evidence.
- New planning modules. Deepen and connect what exists.
- The MCP server and Buzz control surface from ADR-004. Nathaniel still wants
  this. Raise it at the v1 milestone; the base product must remain complete
  without Buzz, and the server remains read-then-propose with human approval.

## Permanent refusals

- No paid tier, payment step, or required paid infrastructure.
- No averaged output from the two demand models.
- No invented data, silent coverage limits, or unsupported zeros.
- No agent-authored consequential facts or direct-to-public agent action.
- No long-running model work inside a serverless request.
- No geography or country-specific assumption in core types or call sites.

## Standing constraints

`CLAUDE.md` and `AGENTS.md` carry the binding product and evidence rules. Two
matter especially when implementing this roadmap:

- Accuracy beats runtime. A run may take hours or days; wall-clock cost is not
  grounds to discard a measurable accuracy gain.
- A green check is evidence only after a relevant mutation proves it could have
  failed for the right reason.
