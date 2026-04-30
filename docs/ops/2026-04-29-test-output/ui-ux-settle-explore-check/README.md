# OpenPlan /explore Local Mapbox Proof Check

Generated: 2026-04-30T05:43:43.651Z
Base URL: `http://localhost:3000`
Storage: ignored local Playwright NCTC demo storage state
Posture: read-only browser navigation and screenshots only; no Supabase, auth, billing, email, credential, or production writes.

## Result

The `/explore` route now captures successfully at both required settle viewports after public Mapbox token normalization was corrected to ignore invalid `sk.*` public candidates and use the available `pk.*` token.

Artifacts:
- `local-ui-ux-settle-capture-ledger.md`
- `local-ui-ux-settle-capture-ledger.json`
- `explore-map--desktop--nctc-layers-ready.png`
- `explore-map--mobile--nctc-layers-ready.png`

Remaining settle gaps remain limited to fixture-required operating surfaces and detail/admin authorization checks from the main `ui-ux-settle` ledger.
