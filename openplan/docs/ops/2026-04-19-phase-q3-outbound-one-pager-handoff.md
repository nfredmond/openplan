---
title: Phase Q.3 — Outbound one-pager (draft copy + handoff)
date: 2026-04-19
decisions_doc: docs/ops/2026-04-19-phase-p-decisions-locked.md
scope_doc: docs/ops/2026-04-19-phase-q-scope.md
prior_slice: docs/ops/2026-04-19-phase-q2-existing-conditions-chapter-proof.md
phase: Q.3
artifact: docs/sales/2026-04-19-nctc-demo-one-pager.md
---

# Phase Q.3 — Outbound one-pager (draft + handoff)

Third and final slice of Phase Q. The scope doc explicitly frames this
as a **non-code commercial lane**: copy, design, PDF build. Exit
criterion is *"Nathaniel (or Claire) can send the one-pager in cold
outreach without any copy-edits."* That clears this session's scope
but needs human sign-off on tone, pricing, and agency-specific copy
before it ships to a real prospect.

## What this slice produced

`docs/sales/2026-04-19-nctc-demo-one-pager.md` — a draft markdown
one-pager structured for easy conversion to PDF (print stylesheet or
Pandoc) or to a static web page. Sections:

1. **Headline framing** — the scope doc's recommended one-liner.
2. **What OpenPlan produced** — concrete numbers lifted verbatim from
   the Q.1 manifest + Q.2 chapter (102,322 residents, 628,262 daily
   trips, 54,944 links, 5/5 station match at 27.4% median APE / 237.6%
   max APE).
3. **What this demo is NOT** — the full caveat list, mirroring the
   chapter's "not a calibrated model" / "not equity analysis" / "not
   transit accessibility" framing.
4. **Screening-grade vs. planning-grade** comparison table so prospects
   can see the upgrade path.
5. **Why this matters for a small RTPA** — the OpenPlan thesis in two
   paragraphs.
6. **The demo workspace** — pointers, is_demo marker note, signed-in
   posture, referenced county-run id.
7. **What you get from a conversation** — concrete walkthrough agenda.
8. **Next steps + contact line placeholder.**

The doc also carries an internal **draft review checklist** and
**data provenance section** so whoever ships it knows which numbers
are authoritative and which decisions still need human input.

## What's explicitly left to Nathaniel / Claire

Per the scope doc, Q.3 is not a code slice. The following decisions
cannot (and should not) be made autonomously:

- **Pricing language.** The one-pager deliberately omits subscription
  pricing. Whether to name the tiers or keep the conversation
  price-discovery is a sales call, not a code call.
- **Demo access posture.** Signed-in only vs. read-only share link is
  flagged in the review checklist — both are viable; the tradeoff is
  friction (signed-in demos require a login hand-off) vs. leakage
  risk (read-only shares can escape to competitors).
- **Tone pass.** The draft leans technical. Claire's voice pass would
  typically soften the "we are deliberately honest about the
  prototype's limits" section and add warmer CTA framing.
- **Contact line.** Left as a placeholder — Nathaniel to fill in the
  preferred channel (email, Calendly, etc.).
- **Named-partner language.** NCTC has not endorsed this demo. The
  copy carefully uses their geography without implying their sign-off;
  that distinction needs a human's eye before sending.
- **PDF build.** Whether to output via print stylesheet (browser
  print-to-PDF on the markdown render), Pandoc, Typst, or a design
  tool (Figma / Affinity) is Nathaniel's call.

## Why this exits Phase Q

- **Q.1** seeded the demo workspace + artifacts. Shipped as `f50fa1f`.
- **Q.2** authored the Existing Conditions chapter composed from the
  frozen run. Shipped as `1e14737`.
- **Q.3** drafted the outbound one-pager that points prospects at Q.1+Q.2.
  Drafted here.

All three Phase Q session-sized slices in the scope doc are now
complete. The commercial-lane work of actually *sending* the one-pager
to prospects is downstream of this phase and belongs in the sales
pipeline, not the code repo.

## First action when a human picks this up

1. Read `docs/sales/2026-04-19-nctc-demo-one-pager.md` end-to-end.
2. Walk the draft-review checklist. Commit corrections in place.
3. Run the seed script against live Supabase (requires service-role
   creds on `.env.local`) so the demo workspace actually exists before
   the one-pager goes out referencing it. Command:
   `cd openplan && pnpm seed:nctc`.
4. Open the seeded demo at `/rtp/{DEMO_RTP_CYCLE_ID}` and the
   `/document` view; verify the chapter renders as expected.
5. If renderer strips tables/blockquotes, file a UI follow-up — the
   data is correct regardless, and the export-path PDF can use its own
   formatting.
6. Decide PDF build path, build the PDF, send.

## What this slice is NOT

- **Not code.** Nothing compiled, nothing tested, no migrations, no
  UI changes.
- **Not a sales strategy document.** One-pager only, no pricing matrix,
  no account plan, no email sequence.
- **Not a replacement for a conversation.** The one-pager explicitly
  invites a 30-minute walkthrough — the pitch is the conversation, not
  the PDF.

## Verification

No test/build verification applies — this is a markdown draft in a
sales folder, not engineering artifacts. Verification is human review
per the checklist.
