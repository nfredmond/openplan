---
title: Phase N — Pilot-readiness breadth, Slice 1 (legal pages) completion note
date: 2026-04-18
program_doc: docs/ops/2026-04-16-openplan-integrated-deep-dive-review.md
supersedes_section_in: docs/ops/2026-04-18-ledger-reconciliation-t2-t3-t10.md
phase: N-slice-1
---

# Phase N — legal pages (3 public routes)

The 2026-04-18 ledger-reconciliation doc closed the 18-ticket
program and listed "pilot-readiness breadth" as a successor
candidate with three deterministic gaps:

1. Legal pages (0/4 — no `/terms`, `/privacy`, `/legal`, `/dpa`).
2. Quota asymmetry (2/19 endpoints enforce the quota gate).
3. Error boundaries (3 total, 10 mega-page folders bare).

Phase N takes the first of those. It ships three public routes
and wires them into the places that need to point at them. No
changes to data access, quota, runtime, or truth-state language.

## What shipped

| Surface | Commit | Status |
|---|---|---|
| `/terms` public route | `4e2bae3` | live |
| `/privacy` public route | `4e2bae3` | live |
| `/legal` public route | `4e2bae3` | live |
| Public-layout footer links | `52dc14a` | live |
| Signup footer disclosure line | `52dc14a` | live |
| Examples rail "internal prototype only" → `/legal` linkback | `52dc14a` | live |

## Copy posture

All three pages were drafted from:

- **Nat Ford operating covenant**
  (`/home/narford/.openclaw/workspace/natford_business_covenant_one_page.md`) —
  truth without spin, fair exchange, community protection, rapid
  repair, responsible AI use, accountability.
- **Existing OpenPlan truth-state language** — "internal prototype
  only," "max APE 237.62%," "screening-grade vs. planning-grade,"
  "supervised early access." These phrases already appear across
  `src/app/(public)/examples/page.tsx`, `src/app/(public)/page.tsx`,
  and `src/lib/examples/nevada-county-2026-03-24.ts`. Phase N does
  not edit the phrases; it builds a home for them on `/legal` so
  they have an authoritative source rather than floating on each
  surface.

### Structural rules followed

- No new UI primitives. Pages use the existing `public-page`,
  `public-hero-grid`, `public-surface`, `public-ledger`,
  `public-ledger-row`, `public-rail` classes (same primitives as
  `/examples`, `/pricing`, and the landing page).
- No marketing-grade claims. Every section describes either what
  the platform does today, what users may do, what they may not
  do, or how the posture may change — no forward-looking
  product-readiness copy.
- Screening-grade discipline preserved. `/legal`'s "Model-output
  limits" ledger quotes the `max APE 237.62%` ceiling verbatim.
  The "internal prototype only" label is defined there as
  authoritative source.

## Wiring changes

### Footer (`src/app/(public)/layout.tsx`)

Added a second link cluster below the existing Pricing / Sign in /
Sign up row:

```tsx
<div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium text-muted-foreground lg:justify-end">
  <Link href="/terms">Terms</Link>
  <Link href="/privacy">Privacy</Link>
  <Link href="/legal">Legal notice</Link>
</div>
```

Smaller type + lower contrast than the primary action cluster —
legal pointers should be accessible, not competing for attention.

### Signup (`src/app/(auth)/sign-up/page.tsx`)

The footer block previously only linked back to `/sign-in`. Now
also surfaces the three agreements an account creation implicitly
enters:

```tsx
<p className="text-xs text-muted-foreground">
  By creating an account you agree to the <Link href="/terms">terms of use</Link>,
  <Link href="/privacy">privacy practices</Link>, and
  <Link href="/legal">legal notice</Link> that govern supervised early access.
</p>
```

Text-only, no checkbox. The sign-up form itself is unchanged; this
is a disclosure line, not a new consent gate.

### Examples rail (`src/app/(public)/examples/page.tsx`)

The "internal prototype only" rail item now links at `/legal`:

```tsx
<div className="public-rail-item">
  The screening gate is displayed as the run emitted it — internal prototype only.
  See the <Link href="/legal">legal notice</Link> for what that label authorizes and forbids.
</div>
```

One-line change that closes the "label exists on the surface but
has no definitive source" gap.

## Why `StateBlock` was not edited

The plan text suggested touching `src/components/ui/state-block.tsx`
to link its truth-state copy at `/legal`. On inspection that
component is a generic state-rendering primitive — it does not
own the "internal prototype only" string. The canonical copy
owners are:

- `src/lib/examples/nevada-county-2026-03-24.ts` (the screening-
  run record's `statusLabel` field),
- `src/app/(public)/examples/page.tsx` (renders the label),
- `src/app/(public)/page.tsx` (repeats it on the landing page).

Editing `StateBlock` would have added a prop that no caller uses.
Linking the phrase where it actually appears (the examples rail)
is the truthful equivalent of what the plan intended.

## Verification

```
pnpm tsc --noEmit            # clean
pnpm test --run              # 761/169 green (unchanged — Phase N has no new tests;
                             # legal pages are server components with no logic)
pnpm build                   # green; /terms /privacy /legal compile as ƒ routes
                             # (server-rendered on demand, no data fetches)
```

Route manifest shows all three paths:

```
├ ƒ /legal
├ ƒ /privacy
├ ƒ /terms
```

Manual spot-checks were deferred to the post-push Vercel Ready
verification. Production deployment is what pilots will load.

## Updated pilot-readiness gap inventory

| Gap | Before Phase N | After Phase N |
|---|---|---|
| Legal pages | 0/4 — no routes, no footer links, no signup disclosure | **3/4** — `/terms` `/privacy` `/legal` live + wired. `/dpa` remains (data-processing agreement, intentionally deferred — low pilot signal, needs a real agency DPA template) |
| Quota asymmetry | 2/19 endpoints enforce quota gate | 2/19 — unchanged (Phase O) |
| Error boundaries | 3 total, 10 mega-page folders bare | 3 total — unchanged (Phase P) |

The `/dpa` slot remains on the inventory and can be filled when
a real agency engagement surfaces the template need. Drafting it
speculatively risks producing a document that doesn't match the
first pilot's actual data-sharing terms — better as pull than push.

## What this unlocks

- **Outbound pilot conversations can cite `/legal` and `/terms`**
  without needing a separate PDF. The supervised-early-access
  posture is now a public URL.
- **Examples page is no longer a dangling truth-state surface.**
  The "internal prototype only" label on the Nevada County
  screening run now points at its authoritative source.
- **Phase Q (90% plan examples, Priorities.md #4)** can proceed
  when ready without needing to bundle its own disclosures —
  `/legal` covers the screening-grade / AI-disclosure ground.

## What did not change

- Truth-state lock language is byte-identical. `max APE 237.62%`
  is unchanged on the examples page; `/legal` repeats it verbatim
  rather than paraphrasing.
- No API, no DB, no server logic. All three pages are static
  server components with no data fetches.
- No consent gates were added. Sign-up still completes without
  checking a box.

## Successor ladder (unchanged from 2026-04-18 plan)

- **Phase O — Quota asymmetry closure.** 17 consumption endpoints
  (reports, engagement, projects, rtp-cycles) need `checkMonthly
  RunQuota`. Design call first: per-workspace vs. per-project vs.
  per-organization quota? Then implement.
- **Phase P — Route-level error boundaries.** Add `error.tsx` to
  10 mega-page folders following the existing `(public)` pattern.
- **Phase Q — 90% plan examples (Priorities.md #4).** Needs
  Nathaniel input on which agency example to build.
- **Phase R — UI/UX Phase 4 browser visual review.** Can run in
  parallel with any coding phase.
- **Phase S — Design-gated unlocks** (T16 reader surface,
  `projects.rtp_posture` body, `projects.aerial_posture` body).
- **Phase T — `projects/[projectId]/page.tsx` decomposition**
  (2863 LOC).

## Pointers

- Approved plan:
  `/home/narford/.claude/plans/eager-munching-spark.md`
- Source covenant:
  `/home/narford/.openclaw/workspace/natford_business_covenant_one_page.md`
- Prior ledger doc:
  `docs/ops/2026-04-18-ledger-reconciliation-t2-t3-t10.md`
- Commits in this phase:
  - `4e2bae3` content(legal): draft Terms, Privacy, Legal page copy as public routes
  - `52dc14a` feat(public): wire footer, signup, examples rail to legal pages
