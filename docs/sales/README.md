# Sales artifact regeneration notes

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

The guard keeps the saleable proof posture inside four explicit boundaries: no broad self-serve SaaS, no legal/LAPM automation, no grant award prediction, and no autonomous AI planning claim.

Keep buyer claims and buyer-safe caveats in the TypeScript source, then regenerate the MD/HTML/PDF outputs. Avoid hand-editing only one generated format; that is how sales packets become three slightly different stories, which is poor trail discipline and worse procurement hygiene.
