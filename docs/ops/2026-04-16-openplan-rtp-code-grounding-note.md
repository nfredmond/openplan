# OpenPlan RTP Code-Grounding Note

**Date:** 2026-04-16  
**Owner:** Bartholomew Hale  
**Status:** Active implementation grounding note  
**Purpose:** capture what the repo already proves about the RTP packet loop and identify the next actual gap to close in code.

## Executive Read

I inspected the live RTP seam after publishing the execution program and owner board.

### Main finding
The **first-packet create + generate path is more real than the planning docs alone suggest**.

That means the next RTP priority should not be framed as “invent packet generation.”
It should be framed as:

1. normalize semantics across touched surfaces,
2. tighten post-action state and proof,
3. land the bounded public-review/comment-response foundation,
4. then move grants harder into the shared spine.

---

## What is already materially real in code

## 1. Shared client helper for first-packet creation and generation exists
File:
- `openplan/src/lib/reports/client.ts`

This helper already:
- creates an RTP board-packet record through `POST /api/reports`
- optionally generates the first artifact through `POST /api/reports/[reportId]/generate`
- returns `reportId`
- returns normalized warning count

### Why this matters
This is no longer a scattered set of one-off UI mutations.
There is a reusable client seam for RTP first-packet actions.

---

## 2. Assistant/runtime path is already wired to `Create + generate`
Files:
- `openplan/src/lib/assistant/operations.ts`
- `openplan/src/components/assistant/app-copilot.tsx`

The assistant operation layer already exposes:
- `create_rtp_packet_record`
- `generateAfterCreate: true`
- post-action workflow prompts for RTP release review

The app copilot already calls `createRtpPacketRecord(...)` and then refreshes assistant preview state.

### Why this matters
The runtime is already more than advisory here.
For RTP first-packet generation, it can already perform a bounded real action.

---

## 3. RTP registry and cycle surfaces already expose packet work posture
Files:
- `openplan/src/app/(app)/rtp/page.tsx`
- `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `openplan/src/lib/assistant/rtp-packet-posture.ts`
- `openplan/src/lib/reports/catalog.ts`

The codebase already has packet posture language and behavior for:
- `No packet`
- `Refresh recommended`
- `Packet current`

It also already includes:
- packet queue logic
- registry row actions
- cycle-level packet creators
- report detail controls
- assistant quick links

### Why this matters
The RTP loop is not missing its core mutation path.
It is mostly missing **consistent operator closure and shared semantic discipline**.

---

## 4. Public-review posture exists as status and date fields, but not yet as a full operator loop
Files/signals:
- `openplan/src/lib/rtp/catalog.ts`
- `openplan/src/app/api/rtp-cycles/route.ts`
- `openplan/src/app/api/rtp-cycles/[rtpCycleId]/route.ts`
- `openplan/src/app/(app)/rtp/[rtpCycleId]/page.tsx`
- `openplan/src/components/rtp/rtp-engagement-campaign-creator.tsx`

The platform already supports:
- `public_review` as an RTP cycle status
- public review open/close timestamps
- engagement campaign linkage to RTP cycles
- cycle detail surfaces that already show engagement activity

### But what is still missing
There is not yet a clear, bounded, first-class **public-review/comment-response loop** that feels like one operator workflow.

The current building blocks exist, but the operator story is still too implied.

---

## What the next real RTP gap is

## Gap A. Semantic normalization across touched RTP surfaces
The app has the right pieces, but the product still risks local interpretation drift.

### Next real work
- confirm registry, cycle detail, report detail, and runtime all use the same packet posture language
- ensure review/release wording matches shared helpers, not route-local phrasing
- ensure post-action next steps are consistent after first generation

### Why this is first
This is the cheapest high-leverage RTP hardening move now that first-packet creation is already materially real.

---

## Gap B. Bounded public-review/comment-response foundation
This is the strongest remaining RTP loop gap after packet creation/generation.

### Next real work
- define the minimum comment-response artifact or summary object
- link it to RTP cycle and engagement campaign posture
- expose it in cycle and packet review surfaces
- ensure the runtime can reference it when recommending release/public-review next steps

### Product rule
Do not try to build the whole civic engagement universe.
Build the smallest truthful foundation that lets OpenPlan say:
- the cycle is in public review,
- these campaigns/comments are linked,
- this is the current response posture,
- and this affects packet readiness.

---

## Gap C. Proof refresh for the RTP loop
Even if the mutation path is real, the proof artifact must be refreshed to match current reality.

### Next real work
- current smoke on first-packet creation/generation
- current smoke on post-action state
- current screenshots or equivalent proof for release-review posture
- explicit note about what remains bounded in public-review flow

---

## Recommended next coding sequence

## Slice 1
**RTP semantics pass**
- tighten shared posture labels
- verify post-action state across registry/cycle/report/runtime
- add or refresh focused tests where needed

## Slice 2
**RTP public-review foundation**
- define one bounded comment-response posture lane
- connect it to cycle detail and packet review posture
- avoid overbuilding

## Slice 3
**RTP proof refresh**
- browser or route-level smoke
- docs/ops proof note

## Slice 4
**Then move harder into Grants OS**
Once RTP is semantically clean and review-ready, push the next major loop into `/grants` and write-back behavior.

---

## Bottom Line

The repo inspection clarified something important:

**RTP first-packet generation is not the main missing feature anymore.**

The main RTP work now is:
- semantic consistency,
- public-review/operator closure,
- and proof refresh.

That is good news.
It means OpenPlan can move from “can generate packets” to “can close the RTP operating loop cleanly,” which is exactly the right gateway before Grants OS becomes the next dominant lane.
