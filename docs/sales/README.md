# Sales artifact regeneration notes

## Current buyer/demo proof packet

Use `docs/sales/2026-05-17-openplan-current-buyer-demo-proof-packet.md` as the current concise buyer/demo proof packet for May 17 evidence. It is a manually curated companion to the generated Admin Pilot Readiness packet, buyer caveat sheet, and managed-support proof map. Keep it buyer-safe: open-source core plus Nat Ford managed services; no self-serve municipal SaaS, autonomous AI, legal/LAPM, validated forecasting, grant-award prediction, or fresh paid-checkout overclaims.

As of the documentation review through commit `e870670`, the current packet distinguishes between shallow deployed health evidence, live alias health currency, and buyer workflow/functionality proof. The formal May 17 evidence artifact captured deployed commit `44457d6`; a later ad hoc live health check showed the canonical alias at documentation-only commit `c8a9afa`. Do not convert code-quality cleanup or documentation-only commits (`2a4a7c5`, `c8a9afa`, `e870670`) into a buyer feature claim; re-run workflow-specific smoke when product behavior changes.

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
