# OpenPlan agent operating manual

Canonical project guidance shared by Codex and Claude Code. Harness-specific
standing preferences still come from their global instruction files.

Detailed history does not belong in this file. The product contract, roadmap,
capability matrix, ADRs, dated research, and executable guards are authoritative.
Git history preserves superseded instructions.

## Start at the destination

OpenPlan is a free, open-source, AI-powered operating system for transportation,
urban, environmental, and land-use planning. The Next.js app is in `openplan/`;
Python workers are in `workers/`.

Before choosing a major lane:

1. Run `npm run product:direction:check` from `openplan/`.
2. Read `docs/product/V1_PRODUCT_CONTRACT.md`, `docs/ROADMAP.md`, the latest
   direction review, `docs/product/US_PLANNING_CAPABILITY_MATRIX.md`, current
   release/CI, known issues, relevant live journeys, and relevant research.
3. Reassess the whole planner, organization, geography, and capability map.
   Treat prior agent decisions and this file as strong evidence, not scripture.
4. Look for a high-leverage omission, including outside the current module map.
   Check this repo, Nathaniel's older projects, and suitable free/open-source
   libraries before building.
5. Start and land the smallest coherent outcome that materially advances v1.

`npm run product:direction:packet` creates a neutral packet for independent
fresh-context reviews. The protocol requires at least two monthly, at milestones,
and when a materially stronger model appears. Preserve disagreement; never pick
the smaller scope merely because it is easier.

## Binding v1 contract

OpenPlan v1 is the ultimate free and open-source operating system for US planning:

- every type of planner completes their core work;
- every state and DC works in substance;
- California is the gold-standard implementation across its full diversity;
- AequilibraE and ActivitySim are operational and scientifically validated
  nationwide for every published use;
- the modules operate as one coherent, self-service product;
- consequential facts, publication, adoption, and money remain human-controlled;
- installation, long jobs, backup, restore, and upgrades require neither
  Nathaniel nor paid infrastructure.

There is no calendar deadline or maximum number of pre-v1 releases. Work may
take the rest of the decade and a model run may take days. Time, effort, runtime,
or version-number neatness never justify a smaller claim.

## Product boundaries

1. **Nothing geographic is hardcoded.** No place, agency, jurisdiction, bbox,
   FIPS code, or jurisdiction count belongs in application logic. Geography
   enters through `src/lib/geographies/place-resolver.ts`,
   `/api/geographies/places`, `/api/geographies/place-boundary`, and
   `src/components/models/study-area-picker.tsx`. Country-specific concepts live
   behind adapters or registries; worldwide use remains the architecture goal.
   Unsupported coverage is visible at the point of use and never looks like zero.
2. **Deepen and connect existing modules by default, but do not let the module
   map cap v1.** Add a module only when a current whole-product review proves a
   core planning need has no coherent home or suitable existing implementation.
3. **Build the product, not outreach.** Nathaniel owns pilots, demos, conferences,
   design partners, and promotion.
4. **Self-service is mandatory.** A founder or manual operator step is a defect.
5. **No paid tier, payment step, or required paid service.** Do not restore Stripe,
   pricing, subscription, quota, or plan gates. `src/lib/invoicing/` is legitimate
   funder reimbursement; `src/lib/runtime/ai-rate-limit.ts` is spend protection.
   Commercial-era database columns remain because destructive cleanup is not
   justified.
6. **Projects and statutory plans are the spine.** Carry geography, evidence,
   people, approvals, and artifacts across modules without re-entry.
7. **Consequential content is human-owned.** Agents may read, explain, draft
   grounded material, and propose safe changes. They may not silently publish,
   adopt, spend, fabricate facts, promote claim tiers, or remove public caveats.

Guard claims on live surfaces. Mechanical documentation references may be
guarded by checking commands, paths, and environment names. Never rewrite a
dated record; supersede it visibly.

## Travel-model science

Both demand methods run. Hold the population, network, assignment, settings,
and evidence boundary constant when comparing them. Preserve each result and
their disagreement; **never average them**. Code computes every number; an LLM
may only narrate grounded facts.

Closed gateway-placement, population-synthesis, and ActivitySim-execution work
must not be resurrected as blockers from old plans. Live scientific limits are
nationwide validation, borrowed behavioral coefficients, distribution,
external/through travel, network loading, unloaded links, road-class coverage,
transit, and observation quality. Check the roadmap and
`docs/modeling/ACTIVITYSIM_RUNTIME_GAP.md` before asserting status.

The repeated 43.3% median APE is the selection metric from the roughly 30%
holdout drawn from a 57-station, one-county dataset. It is neither nationwide
nor independent accuracy evidence. Nationwide accuracy is unknown.

Follow `docs/modeling/VALIDATION_OBSERVATION_UNCERTAINTY_RESEARCH_2026-08-25.md`:

- keep a source-supported observation interval separate from a preregistered,
  use-specific model acceptance tolerance;
- align year, day, units, direction, lane, section, and vehicle definition;
- grade observation and matching quality before seeing model residuals;
- use development, model-selection, and untouched geographic acceptance sets;
- report raw residuals and uncertainty-aware excess error at link, screenline,
  system, state, and archetype scales;
- treat inadequate evidence as `inconclusive`, never passed;
- never widen an interval, drop a bad observation, change a gate, or fit a scalar
  after holdout outcomes are visible.

The old 30% median-APE rule is a provisional diagnostic, not the v1 gate. A
national aggregate cannot hide a failing state, road class, archetype, or use.
Model agreement is sensitivity evidence, not truth.

Accuracy beats runtime. Long work belongs in resumable workers, not serverless
functions. State wall-clock cost without using it to avoid accuracy work. Recheck
the engine landscape through `docs/modeling/OPEN_SOURCE_MODEL_LANDSCAPE.md`.

## Agentic control

MCP/Buzz control is mandatory pre-v1 after its underlying workflows are proven.
OpenPlan stays fully functional without it. ADR-004 builds an MCP **server** that
reads and proposes; it refuses a client that bypasses human approval.

Every new write capability ships with an action-registry entry or an executable
refusal. Extend the existing systems; never create a parallel tool path. Preserve:

- distinct agent authorship, never user impersonation;
- executed-payload approval hashes;
- no claim-tier promotion;
- narrow action scope on every route;
- route-local approval verification and audit;
- reachability from the real summary builder and visible UI, not a fake fixture.

Start at `src/lib/runtime/action-metadata.ts`,
`src/lib/runtime/action-registry.ts`,
`src/lib/assistant/action-approval-server.ts`, relevant `refused-*.test.ts`, and
the reachable-write-surface guards. Recorded refusals carry their argument.

## Evidence and tests

A green check is evidence only if it could fail. For every test or guard written
or changed, mutate the protected behavior, run the test, confirm the right
failure, restore by editing, and report the mutation. Never use `git checkout`
to undo a mutation in a shared tree.

- Test real behavior, not smoke filler, prose, or an import string.
- A mocked Supabase client cannot catch a missing projection; assert `.select()`.
- Inspect reachable writes, not only a route file.
- Visible capability needs a real entry-point journey; callers and jsdom do not
  prove reachability or layout.
- Never reopen or alter sealed evidence. Infrastructure uncertainty is
  `inconclusive`; invented data is forbidden.
- Preserve negative results and fail closed when selected evidence is absent.

Git history archives implementation. Keep durable “why” records, fix or delete
vacuous tests, and wire orphaned working capability before deleting it. Never
sweep schema by name: `billing_invoice_records` and
`engagement_subscriptions` are load-bearing.

## Shared tree and engineering

Confirm repository and package root. Check other sessions and `git status
--short`; announce owned files. Concurrent lanes need disjoint ownership and an
explicit seam. Do not edit a tree while another workflow owns it, kill a process
you did not start, or overwrite unrelated changes.

Prefer the smallest clear, durable design. Read surrounding code and extend an
existing system rather than inventing a parallel one. Do not cosmetically
rewrite working code. Use TypeScript/Python; avoid `any` when a real type exists.
Comments explain use above definitions. Tests target observed regressions.

Before handoff: simplest correct solution, no duplicate capability,
understandable in five years, scales across organizations/geographies, and makes
the repository more coherent?

## Git, releases, documentation

Use one clean `main`. Commit and push verified work at natural checkpoints, then
read GitHub CI. Preserve unrelated user changes.

Semver is literal. User-visible capability normally bumps minor before v1.
Every release updates operator-facing `CHANGELOG.md`, app version, migrations,
and `release-ordering.test.ts` in the tagging commit; push the tag. At v1,
schema and data must remain safe across upgrades indefinitely.

- `docs/README.md` routes current documentation.
- `README.md` is the one-computer setup path.
- `openplan/docs/FIRST_DEPLOYMENT.md` is the team checklist.
- `openplan/docs/SELF_HOSTING.md` and `openplan/docs/ops/RUNBOOK.md` cover ops.
- `docs/ROADMAP.md` is the only active queue; archived plans are history.

Run app commands from `openplan/`:

```bash
npm run dev
npm run build
npm test
npm run lint
npm run qa:gate
npm run test:rls-live
npm run test:workers
npm run product:direction:check
npm run product:direction:packet
npm exec -- supabase start
npm exec -- supabase migration up
```

Critical mechanics:

- npm is the package manager; build uses webpack;
- prefer `supabase migration up`; `supabase db reset` destroys local data and
  requires Nathaniel's approval;
- Supabase clients are deliberately untyped, so projection assertions matter;
- `npm run test:workers` uses each worker's venv;
- model runs write large ignored data under `data/screening-runs/` and
  `data/_screening_cache/`; check disk space and checkout identity;
- if a push bypasses checks, inspect `gh run list --branch main`; the push
  response is not CI evidence.
