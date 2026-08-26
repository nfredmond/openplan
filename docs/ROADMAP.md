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

This is OpenPlan's only active development queue. Dated records under
`docs/ops/`, research results, release evidence, and ADRs are evidence, not
queues. `CHANGELOG.md` is the record of what shipped; this file is only about
what has not. Reconcile this file against the repository by the review date
above.

Rewritten 2026-08-25 from a full-repository review at `391eed25`. The previous
version was a rolling record of the last three releases with a three-item
"Later" list; it described process, not a destination. This one states what
v1.0 means and what stands between here and there.

---

## What v1.0 means

**An agency anywhere in the United States can install OpenPlan, carry a real
piece of statutory planning work end to end, and defend every number in it.**

Three clauses, each with a test that can fail:

1. **Anywhere in the United States.** No module is silently
   California-only. Every module either has national data or states its exact
   coverage limit where the number is read, on the map, in the panel, in the
   export, rather than in a caveat paragraph a reader may never reach.
2. **A real piece of work, end to end.** All seven `qa-harness/first-week-jobs`
   journeys complete from a fresh account, driven by an agent with no
   product knowledge, using only visible navigation, and each ends in an
   artifact a planner could hand to a governing body.
3. **Defend every number.** Every figure in an exported artifact traces to a
   named source with a claim tier, and a figure whose evidence is unavailable
   is withheld rather than estimated.

Plus the release-engineering gate already defined and already nearly met:
worker integrity, a passing restore drill, a populated upgrade rehearsal,
mutation evidence, live RLS, production build, and CI, all against one
candidate commit.

**What v1.0 does not mean.** It does not mean the travel model reproduces
observed traffic counts. It does not mean every state's law is configured. It
does not mean agentic control exists. Those are stated below as post-1.0 work
so they stop being re-litigated at every checkpoint.

---

## Where the product stands (measured 2026-08-25)

- 60 planner-facing pages across 19 navigable surfaces, 256 API routes,
  223 migrations, 5 Python workers.
- 12,400 unit tests, live RLS proof, 42 worker suites, restore drill and
  upgrade-path CI all green at `391eed25`.
- Zero API routes without a caller. 12 registered assistant actions and 14
  executable refusal families covering 60 refused capabilities.
- The 26-finding 2026-08-16 security and correctness review is fully closed,
  including both criticals and the two remote-code-execution install paths.

The product is broad and the engineering discipline is unusually strong. The
gap to 1.0 is not capability; it is **coverage outside California, getting
work back out of the system, and telling the truth about the model where the
number is read.**

---

## v0.35, serious injuries outside California

**The problem.** `openplan/src/lib/safety/sources/registry.ts` registers two
crash adapters: CCRS, which separates fatal from injury crashes inside
California, and FARS, the national **fatality-only** backstop. Outside
California the Safety module ranks "KSI" locations from fatalities alone. SS4A
and HSIP both score on killed *and seriously injured*, so the module's central
output is missing half its definition for 49 states, and the interface does not
say so where the ranking is read.

This is the sharpest live conflict with product non-negotiable #1.

**The work.**
- Extend the crash-source adapter tier so a state DOT crash feed registers the
  way the WA, CO, and OR traffic-count publishers already do. A descriptor, not
  a call-site edit.
- Research which state crash APIs are open and keyless, then register the ones
  that are. Do not guess the list; the CCRS record shows how fast these die.
- Where no injury source is registered, state the severity ceiling **on the
  safety map and in the ranked-locations panel**, before the ranking, in plain
  words: "fatal crashes only. This state's injury data is not connected."
- Carry the ceiling into the safety packet, the grant evidence, and the export.

**Done when.** A fresh workspace in a state with no registered injury source
ranks locations only after saying what it cannot see, and a mutation removing
that disclosure fails a test.

---

## v0.36, get the work back out

**The problem.** OpenPlan reads CSV, XLS, XLSX, ODS, GTFS, GeoJSON, shapefiles
and drone imagery. It writes CSV, GeoJSON and PDF. Agencies live in ArcGIS and
QGIS; a corridor analysis a planner cannot open in their own GIS with its
provenance attached is an analysis they will not stake a grant on. The v0.33/34
importer made the inbound path excellent and left the outbound path where it
was.

**The work.**
- GeoPackage export for the geographic outputs: study areas, corridors, crash
  points, modeled links with volumes, engagement pins, land-use designations.
  One format, not four, because GeoPackage opens in both ArcGIS and QGIS.
- XLSX export mirroring the workbook import, so a portfolio round-trips.
- A per-project evidence bundle: every artifact plus a manifest carrying source,
  retrieval date, claim tier, and known limits for each figure.
- Provenance travels in the attribute table, not a sidecar readme.

**Done when.** A planner exports a corridor, opens it in QGIS, and reads the
source and claim tier of every attribute without opening OpenPlan.

---

## v0.37, one agency, many people

**The problem.** `WORKSPACE_ACTION_ROLE_MATRIX` covers 23 actions across eight
modules. Everything else, meaning safety, grants, projects, RTP, land-use
plans, aerial, documents, measures, and the data hub, authorizes writes by bare
membership
plus a read-only viewer gate. For a single planner that is invisible. For the
actual customer, an agency where an analyst drafts and a director approves, it
means there is no answer to "who may adopt this plan, obligate this money, or
publish this to residents."

The consequential actions themselves already exist and are already human-only.
What is missing is *which* human.

**The work.**
- Extend the role matrix to every module that writes. A new module without a
  matrix entry should be a build error, the way a new role already is.
- Named approval for the consequential actions that exist today: plan adoption,
  stage-gate decisions, publishing to residents, obligating funds, releasing an
  RTP for public review. Record who approved and when, beside the existing
  exact-hash records.
- Make My Work the approval inbox. The review queue landed in `f1ce80fb`;
  approvals are the missing half. This is item 4 of his endorsed backlog.

**Done when.** A `member` cannot adopt a plan, a `viewer` cannot reach the
control at all, and the adoption record names the approver.

---

## v0.38, the model says what it knows, where it is read

**The problem.** The measured position is in
`docs/modeling/WHERE_THE_NUMBER_STANDS_2026-08-20.md`: the screening model puts
roughly **1.7 times too much traffic** on counted roads, about 1.10 times of that
is explained by concentration and **roughly 1.6 times has no identified cause
after seven
measured investigations**. Separately, **77–85% of links inside a study area
carry no assigned traffic at all**, including 96 to 100% of residential and
local streets, because a centroid connector loads a path rather than an area. Held-out median APE is
43.3% against a 30% gate.

None of that is a defect to fix before 1.0; it is the resolution of a screening
model, and chasing it has already consumed weeks. **The defect is that a planner
reading a corridor volume is not told which of those two situations they are
in.** A road with no modeled traffic and a road the model over-assigns look the
same on screen.

**The work. Presentation, not calibration.**
- Per-link coverage state on the corridor map and in every artifact that quotes
  a volume: modeled, unloaded, or outside the network. An unloaded link never
  renders a number.
- The over-assignment bracket travels with the volume, in the panel and the
  export, not only in a caveat block.
- Promote relative framing, with-project versus without-project on the same
  network, over absolute volumes wherever the product can, because that is the
  comparison the model is actually good at and it is what a corridor decision
  needs.
- **Engagement by Safety** (his backlog item 2): cluster resident map comments
  against crash locations. It touches no model volumes, so it is not blocked by
  any of the above, and it is near-ready SS4A evidence.

**Done when.** No surface in OpenPlan can display a modeled volume without its
coverage state, and a mutation that drops the coverage state fails a test.

---

## v1.0, the stranger test

- The full release gate against one candidate commit: `qa:gate`,
  `test:rls-live`, `test:workers`, `ops:restore-drill`, upgrade rehearsal,
  mutation evidence, CI.
- All seven first-week journeys complete with zero blocked or failed jobs.
- **One person who is not Nathaniel installs OpenPlan from `README.md` on a
  clean machine and completes the project journey without help.** Self-service
  is non-negotiable #4 and it has never been tested by a stranger. Agents
  driving a browser are not the same evidence.
- Documentation consolidated: dated evidence archived by period, one navigable
  index, and the agent instruction files reconciled against the tree.
- `docs/ops/KNOWN_ISSUES.md` carries no open item rated Blocker or High whose boundary
  is not disclosed inside the product.

---

## Deliberately not in v1.0

Stated so they stop costing sessions. Each is wanted; none is a release
blocker.

- **Chasing the unexplained 1.6 times.** Seven measured investigations have ruled out zone size,
  tertiary under-assignment, missing local travel, and count-seeding, and sized
  concentration and boundary disposition. It is a post-1.0 research lane. The
  product's answer at 1.0 is disclosure, not a fitted scalar, and a nationwide
  scalar sweep would publish the same failure everywhere with a better-looking
  number attached.
- **Averaging the two models.** Permanently rejected. Agreement is
  methodological sensitivity, and the pre-registered holdout proved it does not
  predict accuracy.
- **Crash rates per modeled VMT.** Blocked until modeled road coverage supports
  a denominator. Deferring it is the honest call, not a delay.
- **MCP server and Buzz agentic control.** ADR-004 stands: build the server
  (read → propose), refuse the client. Implementation waits for module
  maturity. **Nathaniel asked to be reminded he still wants this, so raise it at
  every roadmap milestone.** Meanwhile every new write capability keeps earning
  a registry entry or a recorded refusal, which is what keeps it cheap.
- **New modules.** Non-negotiable #2. Land Use Plans was an explicit,
  one-time exception.
- **Additional jurisdiction legal bundles beyond what research justifies.**
  Neutral degradation is the correct behavior; adding bundles is data work that
  should follow a real user, not precede one.

---

## Standing constraints that outrank this file

Product non-negotiables live in `CLAUDE.md` / `AGENTS.md`. The two that most
often collide with a plausible-looking plan:

- Nothing is hardcoded, and the architecture must not assume the United States.
- Accuracy beats runtime. A run may take hours or days. "It would be slow" is
  never a reason not to try something. Say what it costs in wall-clock and let
  Nathaniel decide.
