# Sales artifact notes

OpenPlan's core is free and open source (Apache-2.0). These materials support the
optional Nat Ford managed-hosting / implementation-services lane — reached via the
`/request-access` paid-services inquiry path — never a paid product tier.

## Buyer-safe claim boundaries

`docs/sales/2026-05-01-openplan-buyer-safe-caveat-sheet.md` holds the buyer-safe
caveats, and `docs/sales/2026-05-10-openplan-managed-support-proof-map.md` ties
each managed-support claim to its proof artifact and caveat boundary.

Before committing buyer-facing sales/proof copy, run the compact claim-boundary
guard from `openplan/`:

```bash
npm run test:sales-proof-claim-boundaries
```

The guard keeps the saleable proof posture inside four explicit boundaries: no
broad self-serve SaaS, no legal/LAPM automation, no grant award prediction, and
no autonomous AI planning claim. Keep buyer claims and buyer-safe caveats aligned
across the `.md`, `.html`, and `.pdf` variants of a given doc — never hand-edit a
single format, which is how one packet becomes three slightly different stories.

## Nevada County evidence

`docs/sales/2026-05-17-openplan-nevada-county-buyer-evidence-brief.md` is a static
screening-run snapshot only: internal prototype, screening-grade, and not
production model validation.
