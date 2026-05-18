# Sales artifact regeneration notes

## Current buyer/demo proof packet

Use `docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md` as the current concise buyer/demo proof packet for May 17 evidence. It is a manually curated companion to the generated Admin Pilot Readiness packet, buyer caveat sheet, and managed-support proof map. Keep it buyer-safe: open-source core plus Nat Ford managed services; no self-serve municipal SaaS, autonomous AI, legal/LAPM, validated forecasting, grant-award prediction, or fresh paid-checkout overclaims.

Use `docs/sales/2026-05-17-openplan-buyer-demo-evidence-note.md` as the current dated operator evidence note for the proof-first buyer-demo rehearsal. It records the production health check, `npm run ops:check-buyer-demo-preflight -- --live-reads`, authenticated Command Center → Pilot Readiness → Request Access → Examples browser rehearsal, safe claims, and claims to avoid.

Use `docs/sales/2026-05-17-openplan-90-second-buyer-demo-talk-track.md` as the current short operator script before a supervised buyer walkthrough. It is deliberately proof-first, names the Nevada County internal-prototype gate and Max APE caveat, preserves the request-access boundary, and closes by scoping one supervised first workflow rather than implying self-serve activation.

Use `docs/sales/2026-05-17-openplan-nevada-county-buyer-evidence-brief.md` as the copyable Nevada County buyer evidence brief. It is a static screening-run snapshot only: internal prototype, screening-grade, and not production model validation.

As of the checkpoint continuation through operator-surface commit `35bfa58e`, the current buyer-demo path is smoke-tested for a supervised walkthrough only. Command Center now includes read-only Nevada County sample story beats, a caveat rail, a demo narration rail, the 90-second opening script, and a compact demo rehearsal checklist; `/examples` includes the matching Command Center handoff cue plus an optional signed-in return path to `/command-center`. The buyer-demo preflight now runs both the Nevada County fixture guard and the buyer-demo talk-track guard so the internal-prototype gate, Max APE caveat, story beats, spoken-script boundary, and forbidden buyer claims are checked directly. Recent guardrail commits are: `109f18d2` adds the talk-track guard to buyer preflight, `a962072d` adds the Command Center rehearsal checklist, and `35bfa58e` tightens checklist stop-condition copy. The follow-on evidence-brief/public-preflight and proof-index sync slices (`4af88ee1`, `dd2325ac`, `35d9b970`, `ad30a6f8`, `020eda85`) add a copyable Nevada County brief, make the live buyer-demo preflight check `/examples` as well as request access, index the May 17 buyer-demo proof artifacts in Admin Pilot Readiness, refresh generated static packet artifacts, and clarify proof-sync currency. Treat these as operator-surface/script/checklist/proof-package guardrails, not new buyer functionality. Do not convert code-quality cleanup, documentation-only commits, generated packet refreshes, or shallow health checks into buyer feature claims; re-run workflow-specific smoke when product behavior changes.

## Admin Pilot Readiness proof packet

The following files are generated artifacts and should travel together in the same commit:

- `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md`
- `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html`
- `docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf`

Canonical source lives in `openplan/src/lib/operations/pilot-readiness-packet.ts`; the renderer lives in `openplan/scripts/ops/generate-admin-pilot-readiness-proof-packet.ts`.

Regenerate from `openplan/`:

```bash
npm run ops:generate-admin-pilot-readiness-proof-packet
```

Before committing proof-packet work, run the drift guard from `openplan/`:

```bash
npm run ops:check-admin-pilot-readiness-proof-packet-drift
```

Before committing buyer-facing sales/proof copy, run the compact claim-boundary guard from `openplan/`:

```bash
npm run test:sales-proof-claim-boundaries
```

Before a supervised buyer/demo conversation, run the buyer-demo preflight from `openplan/`:

```bash
npm run ops:check-buyer-demo-preflight
```

Use `--live-reads` only for the final operator rehearsal when read-only production health and Vercel checks are intentionally allowed. The default run is local-first/read-only and does not write evidence files, apply schema, provision workspaces, trigger checkout, or print secret values.

The guard keeps the saleable proof posture inside four explicit boundaries: no broad self-serve SaaS, no legal/LAPM automation, no grant award prediction, and no autonomous AI planning claim.

Keep buyer claims and buyer-safe caveats in the TypeScript source, then regenerate the MD/HTML/PDF outputs. Avoid hand-editing only one generated format; that is how sales packets become three slightly different stories, which is poor trail discipline and worse procurement hygiene.
