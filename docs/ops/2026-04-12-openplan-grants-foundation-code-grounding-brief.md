# OpenPlan Grants Foundation Code-Grounding Brief — 2026-04-12

**Owner:** Bartholomew Hale  
**Purpose:** ground the next OpenPlan build lane in the code that already exists so Grants OS grows from the shared spine instead of becoming a side tracker.

## Executive summary

OpenPlan is not starting Grants OS from zero.

There is already a meaningful grants-adjacent spine in production code:
- project-level funding need anchors,
- funding opportunity records,
- pursue / monitor / skip decisions,
- funding awards,
- reimbursement posture,
- assistant mutations,
- workspace command-queue pressure,
- and RTP read-through of project funding posture.

That means the next real problem is **not inventing grant objects**. The next real problem is **turning scattered project/program funding surfaces into one shared workspace grants operating lane**.

## Current code-grounded truth

### 1. Workspace-level grants pressure already exists

`openplan/src/lib/operations/workspace-summary.ts`
- already computes funding/grants command pressure for:
  - funding need anchors
  - sourcing opportunities
  - decision gaps
  - award recording
  - reimbursement start / active posture
  - remaining funding gaps
- already generates queue keys such as:
  - `source-project-funding-opportunities`
  - `advance-project-funding-decisions`
  - `record-awarded-funding`
  - `close-project-funding-gaps`

This is already the beginnings of a shared Grants OS command model.

### 2. Assistant runtime already has grant mutations

`openplan/src/lib/assistant/operations.ts`
`openplan/src/components/assistant/app-copilot.tsx`

The assistant can already:
- create project/program funding profiles,
- create funding opportunities,
- mark lead opportunities `pursue`,
- record awarded funding,
- route users back to the canonical funding lane on project/program pages.

This matters because Grants OS does **not** need a brand-new mutation architecture first.

### 3. Project detail already behaves like a local grant control room

`openplan/src/app/(app)/projects/[projectId]/page.tsx`

The project page already has a serious funding section with:
- funding need summary,
- award totals,
- likely pursued dollars,
- remaining gap,
- match posture,
- reimbursement posture,
- next obligation,
- funding profile editor,
- funding award creator,
- opportunity registry,
- decision controls,
- award-linked invoice chain.

This is much stronger than a placeholder “grant tracker”.

### 4. Program pages already support funding opportunity creation/decision posture

`openplan/src/components/programs/funding-opportunity-creator.tsx`
`openplan/src/app/(app)/programs/[programId]/page.tsx`

Programs already participate in the same funding-opportunity object model.

### 5. API layer already supports the first grants mutation loop

`openplan/src/app/api/funding-opportunities/route.ts`
`openplan/src/app/api/funding-opportunities/[opportunityId]/route.ts`

The funding-opportunity API already supports:
- authenticated creation,
- workspace resolution,
- project/program linkage validation,
- decision updates,
- audited mutations.

### 6. RTP already consumes funding posture

`openplan/src/app/(app)/rtp/page.tsx`
`openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`

RTP already reads project funding profiles, opportunities, awards, and invoice-linked reimbursement posture to show:
- funded / likely covered / unfunded portfolio state,
- reimbursement status,
- award risk,
- cycle-linked project funding posture.

So part of the required Grants OS write-back is already real on the RTP side.

## The main gap

The biggest missing piece is now clear:

**There is no shared workspace Grants OS surface yet.**

Current grant/funding truth is distributed across:
- project detail,
- program detail,
- assistant quick actions,
- workspace summary,
- RTP funding summaries.

What is missing is the workspace-level operating lane where a planner can:
- scan all opportunities across the workspace,
- filter by closing soon / pursue / monitor / skip / awarded / reimbursement risk,
- see the lead command queue item,
- jump into the affected project/program,
- and manage grants as one connected operating system.

## Recommendation: next implementation slice

### Build the first workspace Grants registry page

**Recommended route:** `/grants`

### Minimum acceptance criteria
- lists funding opportunities across the active workspace
- shows summary cards for:
  - tracked opportunities
  - pursue
  - monitor
  - skip
  - closing soon
  - award-record gaps or reimbursement risk where available
- exposes the lead queue posture already computed in `workspace-summary.ts`
- links each row back to the canonical project/program funding lane
- uses the existing funding-opportunity object model, not a parallel schema

### Hard rule
Do **not** create a second grants truth model for this page.
Reuse the existing:
- `funding_opportunities`
- `project_funding_profiles`
- `funding_awards`
- workspace command queue
- assistant mutation registry
- RTP funding posture consumers

## Exact next code seams

### Read models / source of truth
- `openplan/src/lib/operations/workspace-summary.ts`
- `openplan/src/app/api/funding-opportunities/route.ts`
- `openplan/src/app/api/funding-opportunities/[opportunityId]/route.ts`
- `openplan/src/app/(app)/projects/[projectId]/page.tsx`
- `openplan/src/app/(app)/programs/[programId]/page.tsx`

### Donor UI patterns
- `openplan/src/app/(app)/reports/page.tsx`
- `openplan/src/app/(app)/rtp/page.tsx`

### Likely first new files
- `openplan/src/app/(app)/grants/page.tsx`
- optional shared helper if the grants page needs a reusable registry mapper

## What not to do next
- do not jump straight to reimbursement/compliance deep automation first
- do not build a decorative “Grant AI Lab” shell disconnected from project/control truth
- do not add a second opportunity schema or duplicate registry logic
- do not call Grants OS real until the shared workspace route exists and reflects live write-back state

## Bottom line

The strongest honest next move is:

**build `/grants` as the first shared workspace operating surface for the grant objects OpenPlan already has.**

That turns today’s scattered but real funding spine into the beginning of a true Grants OS.
