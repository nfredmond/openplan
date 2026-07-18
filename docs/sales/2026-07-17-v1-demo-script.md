# OpenPlan v1 — Demo Script (~15 minutes)

Audiences: city engineers, planning directors, consulting firms, MPOs/RTPAs, Caltrans, tribal governments. The through-line: **one platform where the map is the worksurface, every number carries its provenance, and AI is powerful because it is auditable.** Follow the runbook (`docs/ops/2026-07-17-v1-demo-runbook.md`) first; demo in dark theme; stay on the seeded NCTC workspace.

## 0. Cold open (30s) — the shell

Sign in, land on the dashboard. Don't talk features yet — let the cartographic shell register: live county map behind everything, projects/corridors/RTP/engagement as clickable layers, workspace KPIs in front. One line: *"This is an operating system for a planning department — the map isn't a page in the app, it's the floor the whole app stands on."*

Click a corridor on the backdrop → inspector opens. Toggle a layer. Move on.

## 1. Projects & delivery (2 min) — for the engineers

Projects → open the seeded project. Control room: milestones, submittals, invoices, risks, decisions, funding posture — one screen. **Mark a milestone complete** (status advance button). Show the invoice register with retention math and the award closeout gate (*"closeout is blocked until reimbursements hit 100% — the LAPM discipline is in the workflow, not in a binder"*).

## 2. Grants (3 min) — the money story

Grants in the nav. Walk the pipeline lanes fast, then the two beats:

1. **Program catalog**: 15 real CA/federal programs (ATP, HSIP, SS4A, BUILD, TIRCP…) → click **Track as opportunity** on one. It's in the pipeline instantly.
2. **AI narrative draft** on the focused opportunity → generate live. When it renders, point at the grounding line: *"**N of M sentences cite verifiable workspace facts** — every claim in that draft is traceable to a number in this workspace, and the sentences that aren't verified are flagged for your review. That's what AI grant writing has to look like for a public agency."*

## 3. The Planner Agent (2 min) — AI with receipts

Open the copilot. Ask a real free-text question (*"Where does our grant pipeline stand and what should I do first?"*) — streamed answer grounded in workspace data. Then run a suggested action that requires approval → the **approval sheet** (what it does, what gets recorded) → approve → open **Agent Activity** from the nav: the executed action is in the ledger with its hash and approval class. Line: *"Every AI action is approval-gated, single-use, and audited. Your IT director and your county counsel can read this page."*

## 4. Community engagement (4 min) — the crowd-pleaser

Engagement → seeded campaign → copy the public share link → **open it on a phone** (or second window). As the public: **draw a line** along a road, write a comment, **attach a photo**, submit. Show existing approved comments — points, the SR-49 line, the downtown polygon — and **tap Support** on one; the count ticks up. Sort by most supported.

Back as staff: the new submission is in the moderation queue (pending, geometry preview, photo thumbnail) → approve it → refresh the public page: it's live on the map. *"Points, corridors, or whole areas; photos; community support counts; and nothing reaches the public map until staff approves it."*

## 5. Analysis & modeling (3 min) — for the technical crowd

Analysis Studio: open a completed corridor run (pre-run per the runbook). Demographics, transit access, crash history, equity screen → generate the ATP-ready report. If any metric wears an **"Estimated"** badge, feature it: *"When a federal API is down, OpenPlan labels the fallback instead of faking the number."*

County Validation → the Nevada County run: real network model evidence (screening-grade, and it says so) → the **CEQA §15064.3 VMT screen**: set the reference average, get the determination with statutory citations → **download the memo**. Line: *"Screening-grade is a feature — the platform physically can't overclaim; every output carries its caveats."*

## 6. Close (1 min)

- **Free and open source (Apache-2.0).** Self-host it tomorrow; no per-seat tax.
- **Nat Ford Planning** provides hosting, onboarding, customization, and planning services on top — that's the business.
- Roadmap honesty beats: photo-to-orthomosaic aerial processing, live grants.gov sync, and richer demand modeling are next — tracked in the open repo.

**Q&A safety rails:** modeling is screening-grade, never "calibrated forecasting." LAPM is delivery tracking + invoice register, not E-76 form generation. Aerial is mission/evidence tracking today; imagery processing is roadmap. These boundaries are enforced by tests — say them proudly, not apologetically.
