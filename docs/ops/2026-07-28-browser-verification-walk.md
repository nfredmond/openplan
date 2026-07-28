# Live-browser verification walk — 2026-07-28

The 2026-07-27 vision push shipped ~50 commits with unit/route/build coverage but no browser
proof. This session walked every new surface in a real browser (Playwright-driven Chrome against
`next dev --webpack` on :3001, local Supabase, freshly seeded NCTC demo workspace, real
`ANTHROPIC_API_KEY`) and fixed what it found. Facts below are what was actually exercised —
nothing more.

## What was proven

**Invoicing (receivables lane, Wave B) — full pass, no defects.**
Client create → engagement with $50,000 NTE → staff + engagement-scoped rate table
($185/hr Senior Planner) → two time entries (6h + 4h) → compose invoice → pull-unbilled-time
aggregated both entries into one $1,850 line with the rate source disclosed → save (entries
stamped Billed; NTE showed the draft distinctly as "composed, not yet billed") → mark sent
(cash strip $1,850 owed; NTE $1,850 billed / $48,150 remaining) → PDF download (real 35KB
`%PDF-1.4`, correct attachment filename) → void (confirm dialog states the consequences; both
entries returned to Unbilled; NTE reset to $0; number stays claimed). Register counts correct at
every step. Zero console errors.

**Grants applications + proposals (Wave C) — pass with fixes.**
LPP catalog template seeded 4 sections (match section correctly "Never AI-drafted") + 2-item
attachment checklist. Live AI draft (claude-haiku-4-5) ran; sentence validation flagged 10/11
uncited sentences; **finalize-unedited refused** (422 + per-sentence list); manual
finalize-edited path worked (operator authority language). Export with 1 required attachment
missing → **"Stamped DRAFT — 1 required attachment(s) outstanding"**, 210KB PDF, stable
re-download. Proposal pursuit: created via pursuit-kind select, template seeded 5 sections, fee
section structurally has **no Draft-with-AI control**, export produced the **PROPOSAL PACKET
cover variant** (issuing agency / solicitation number / proposals due; "0 of 5 sections final"
disclosed honestly).

**Assistant agent (Wave C) — pass with fixes.**
Read tool fired with an honest activity chip ("Looked up: 3 funding opportunities") and a
correct grounded table. Propose flow: clarifying questions → proposal card with **full payload
disclosure** → "Approve & run" → second approval sheet ("Exactly what you are approving", audit
evidence notice) → executed → row in DB → `/assistant-activity` ledger entry with input hash,
"Succeeded · Approval required". A failed propose attempt was disclosed as a failed chip, never
hidden. Simulated network failure on the chat POST → visible "Failed to fetch" error frame, no
empty bubble.

**Reports + RTP + campaign reports (Wave C + A) — pass with fixes.**
Project report AI section draft was **properly grounded** (7/9 sentences cited real funding
figures); accept-unedited refused with the flagged list; operator-edited accept worked;
generated packet carries the labeled block ("DRAFTED WITH AI ASSISTANCE — REVIEWED AND
ACCEPTED"), a per-block provenance footer (cited-sentence count, operator-edited, model,
timestamp), and an AI-assisted-blocks appendix. Changing the underlying project flipped the
report to **refresh-recommended** (drift panel names what changed). RTP chapter draft →
insert-into-editor handoff worked ("edit it as your own text"). Campaign handoff report created
from the engagement console and generated a real packet.

**Spine (Wave A).** Explore page has the attribute-to-project picker; report generation recorded
`modelingEvidenceCount: 1` with `screening_grade` claim status; scenario entries carry the
attached-run combobox with distinct-run readiness gating; project page shows the Budget & pace
panel with honest refusals ("no deliverables recorded yet, so there is nothing to judge burn
against"); safety ingest has optional project attachment + the CA-only CCRS disclosure; KB has
the project filter; all app routes 307 to `/sign-in?redirect=…` signed out.

**Migrations.** `supabase migration list`: local and remote agree through `20260727000016`,
in order.

**qa-harness local smokes: 4/4 green** after repairs (below) — `local-spine-smoke`,
`local-grants-flow-smoke`, `local-engagement-report-handoff-smoke`,
`local-analysis-report-linkage-smoke`, each run against the live :3001 dev server.

## Defects found and fixed (this commit)

1. **Report creation 400'd on the promised default title** (`report-creator.tsx`): leaving the
   title blank submitted `""`, which the API rejects — despite the form saying "Leave blank to
   use <default>". Now submits the derived default. Test added.
2. **Grant-pursuit drafting had no project facts** (`narrative-evidence.ts`): the linked
   project's status/phase facts were proposal-only and `projects.summary` was never selected, so
   a "Project narrative" draft had literally nothing about the project to cite — the model
   (correctly) refused and produced meta-commentary. Project identity facts (name, status,
   delivery phase, summary) now ground BOTH pursuit kinds. Verified live: the re-draft cites the
   project summary fact; remaining refusals are honest (the demo workspace has no quantified
   needs data). Tests added.
3. **Assistant chat glued text parts across tool calls** (`chat-stream.ts`): "…identifier:Now I
   can propose…", "…detail.## Workspace Summary". The reducer ignored `text-start` frames; it
   now inserts a paragraph break between distinct text parts. Tests added.
4. **Proposal workspace spoke application language** (`funding-opportunity-application-workspace.tsx`):
   Open/Close button and export block now say "proposal workspace" / "Export proposal packet"
   for proposal pursuits.
5. **qa-harness rot**: the two seed-shelling smokes ran `pnpm seed:nctc` (repo is npm-only —
   hard failure); all 20 browser smokes now honor `OPENPLAN_QA_CHROME` (Playwright's bundled
   chromium does not install on this OS); the engagement-handoff smoke's row selector matched
   the appendix-readiness card instead of the moderation row; two smokes clicked
   "Generate HTML packet" without first selecting HTML in the format combobox.

## Observations recorded, not fixed here

- **"Workspace tier: Pilot" renders on the project page** (Project control room card) — the
  dead `workspaces.plan` read surfacing in the UI; the Wave 4 dead-plan-read sweep covers it
  (this walk confirms it is user-visible beyond the assistant).
- The assistant has **no invoice read tool** — it honestly says so when asked about invoices.
  Candidate follow-up alongside Wave 4.
- Operator-edited final text renders literally in packet PDFs (a typed `# Heading` shows the
  `#`). Deterministic by design; cosmetic.
- `[fact:N]` display-stripping produces odd prose only when a draft uses citation tokens as
  sentence subjects (meta-commentary case) — normal grounded drafts read cleanly.
- Playwright bundled browsers do not install on this machine's OS; use
  `OPENPLAN_QA_CHROME=/usr/bin/google-chrome` with the local smokes.
