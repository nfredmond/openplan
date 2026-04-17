---
title: OpenPlan write-back loop — live-render proof (dashboard + project detail + grants)
date: 2026-04-16
head_sha: c7039c531542a22c7d7b8757ce73cf199390e95f
workspace_id: dd68626b-3462-4aa4-94ea-4840b2dae019
user_id: 44e09473-6680-46b9-8664-a2054590f2e6
project_id: 73f7375b-a8b0-4a4a-9dfe-67f3a1066515
award_id: 345e47fd-b30d-4fdd-9d70-67f8c10084c8
---

# OpenPlan write-back loop — live-render proof

Companion to `2026-04-16-writeback-loop-api-proof.md`. That doc proved the
HTTP + DB chain (`POST /api/funding-awards` → `funding_awards` →
`project_milestones` obligation → `projects.rtp_posture`) lands against a
fresh local Supabase. This doc proves the downstream consumers — the
server-rendered UI surfaces — actually render the written data.

Every page below is a **Next.js Server Component** calling
`createClient()` (the `@supabase/ssr` client). There are no mocks in this
loop. The cookie is a real `signInWithPassword` session; every row that
surfaces came out of the local Supabase via RLS-enforced queries.

## Fixture reuse

The fixture from the API proof is still live in local Supabase (verified
before this run):

```
 rel                                        | count
--------------------------------------------+-------
 workspaces (dd68626b-...)                  |     1
 projects (73f7375b-..., Write-back Proof)  |     1
 funding_awards (345e47fd-..., Proof STP)   |     1
 project_milestones (obligation w/ award)   |     1
 projects.rtp_posture committedFundingAmount|  250000
 projects.rtp_posture nextObligationAt      | 2026-10-01T00:00:00+00:00
```

## Auth

User `proof+2026-04-16@natford.dev` password-reset via the Supabase admin
API (service role), then `signInWithPassword` on the anon client, then
the session packed into an `@supabase/ssr`-compatible cookie
(`sb-127-auth-token`, value `base64-<JSON.stringify(session)>`). Identical
pattern to the API proof; the only new piece is reusing the session for
SSR page fetches instead of an API POST.

## Surface 1 — `/projects/<projectId>` (primary posture consumer)

`GET http://localhost:3000/projects/73f7375b-a8b0-4a4a-9dfe-67f3a1066515`
→ **200 OK, 709,333 bytes of HTML**.

Marker grep against the response body:

```
Write-back Proof Project        FOUND @21026   (project name)
Proof STP Award                 FOUND @102103  (award title — from write-back)
$250,000                        FOUND @98912   (committed funding)
250,000                         FOUND @98913
Committed                       FOUND @98836   (label above dollar figure)
2026                            FOUND @4735    (milestone date fragment)
```

`committedFundingAmount` on this page is **not** pulled from the
`rtp_posture` JSONB — it is re-aggregated on each load by
`loadProjectFundingSummary` in `src/lib/projects/funding.ts`, which
reduces over `funding_awards.awarded_amount` directly. That's deliberate:
the aggregate should always match the canonical rows, and the posture
JSONB serves other consumers (RTP cycle, reports) that want a snapshot.

**What this proves:** the same award row the write-back loop wrote
(`POST /api/funding-awards` → DB) flows through the live Server Component
render path into an HTML response the browser would receive. T11/T12/T13
is now live-render confirmed on the primary consumer, not just
HTTP + DB layer.

## Surface 2 — `/grants` (secondary consumer)

`GET http://localhost:3000/grants` → **200 OK, 510,488 bytes of HTML**.

```
Write-back Proof Project        FOUND @24570
Proof STP                       FOUND @35761   (funding program)
Proof STP Award                 FOUND @64416   (award title)
$250,000                        FOUND @59792
250,000                         FOUND @59793
obligation                      FOUND @77913   (milestone label)
```

This is a useful side-proof of T10 (grants page decomposition). After
the 1498→677 LOC refactor, the page still server-renders the full award
row including the $250,000 committed amount and the linked obligation
milestone. No 500s, no missing widgets.

## Surface 3 — `/dashboard` (operations overview)

`GET http://localhost:3000/dashboard` → **200 OK, 218,096 bytes of HTML**.

```
Write-back Proof Project        FOUND @29918   (project name in worksurface)
Proof STP                       FOUND @34289   (program name)
Overview                        FOUND @5637    (page header)
$250,000                        not found     (expected — see below)
Awards recorded                 not found     (expected — see below)
```

The dashboard **does not** surface the per-project dollar figures or the
`rtp_posture.label` string (`"Awards recorded"`). That's a design choice,
not a write-back gap: dashboard is operations-level (KPI grid, run
history, quick actions), and per-project finance lives on
`/projects/[id]` and `/grants`. The dashboard render still reaches into
live Supabase — visible from the project name and program name surfacing
from the same workspace rows — but it intentionally rolls up on KPIs and
activity rather than posture dollars.

## What this closes

Before this doc:

- API proof existed (HTTP + DB chain).
- Dashboard render against live Supabase was only covered by unit tests
  with stubbed children (per `2026-04-16-writeback-loop-api-proof.md`
  and the 2026-04-16 integration-discipline memory).
- T18 (dashboard decomposition) had unit coverage but no live-render
  artifact; T10 (grants decomposition) had test-green but no live proof
  the decomposed page actually renders.

After this doc:

- T10 — `/grants` live-rendered against local Supabase with the real
  award row surfaced (510KB HTML, no 500s).
- T18 — `/dashboard` live-rendered against local Supabase (218KB HTML,
  200 OK, workspace row surfaced).
- T11/T12/T13 — the write-back's primary UI consumer
  (`/projects/[projectId]`) live-renders $250,000 committed + the award
  title, confirming the loop is end-to-end: POST → DB → live SSR → HTML.

## What this does not close

- **Browser-GIF**: still open. A recorded interactive session (click
  "Convert to award" → see the dashboard update) remains the richest
  form of evidence for an external audience (Pilot demos, RFP reviews).
  The Claude-in-Chrome extension pairing issue that blocked this during
  the API-proof session is unrelated to the code; any operator with a
  working Chrome session could produce it today.
- **RTP cycle page** (`/rtp/[rtpCycleId]`): the project isn't attached
  to any RTP cycle in this fixture, so T17 ("RTP cycle posture") is not
  exercised. Seeding an RTP cycle + portfolio entry + running this same
  curl against `/rtp/<cycleId>` would close that.
- **Caveat gate** (T16): code exists; this render proof doesn't call the
  caveat path, so the "fail closed" policy is still unexercised.

## Reproducibility

The node script used for this proof writes the three HTML files to
`/tmp/live_*.html` and prints marker-grep results to stdout. It
(a) admin-resets the proof user's password, (b) signs in via the anon
client, (c) packs the session into an `sb-127-auth-token` cookie,
(d) fetches each route with the cookie. Running it requires the local
Supabase stack up (`pnpm supabase start`), the dev server running
(`pnpm dev`), and the fixture from
`2026-04-16-writeback-loop-api-proof.md` present (`funding_awards` row
`345e47fd-...` in place). The script itself is transient — it lives
alongside the run and is deleted after — because (a) it stores a live
access token in a JS string, and (b) the same pattern is trivially
re-derivable from this doc if anyone needs to reproduce.
