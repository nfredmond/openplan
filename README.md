# OpenPlan

OpenPlan is Apache-2.0 open-source planning software for transportation and land-use teams that need traceable maps, engagement, project records, modeling evidence, and delivery packets without a black-box vendor dependency.

Nat Ford Planning builds and maintains the project. The commercial model is services around the open-source core:

- managed hosting and workspace administration;
- implementation, onboarding, and staff training;
- support retainers and operational QA;
- planning services for RTP, ATP, grants, engagement, and project-list workflows;
- custom extensions, integrations, reports, and AI-assisted workflow buildouts.

Stripe/billing code remains in the repository because Nat Ford-operated hosted workspaces need payment, entitlement, usage, and support infrastructure. That infrastructure is for managed hosting and services; it is not intended to turn the Apache-2.0 core into a closed source license.

## Repository layout

- `openplan/` — main Next.js application.
- `docs/` — product, proof, operations, governance, and planning documentation.
- `qa-harness/` — local and production smoke-check scripts.
- `scripts/` — validation, modeling, and operator utilities.
- `schemas/` — reusable schemas.

## License boundary

Unless otherwise marked, source code is licensed under the Apache License, Version 2.0. See `LICENSE` and `LICENSE-NOTICE.md`.

The license does not grant rights to Nat Ford Planning trademarks, logos, private credentials, client confidential information, third-party datasets, third-party media, or client-specific deliverables unless those materials are explicitly included under the same license.

## Development quick start

```bash
cd openplan
pnpm install
pnpm dev
```

Useful gates:

```bash
pnpm lint
pnpm test
pnpm build
```

## Current product truth

OpenPlan is production-backed but still supervised. It is strongest today as a planning workbench with guided rollout, managed-hosting support, and evidence-aware workflows. It should not be described as a finished autonomous municipal SaaS, validated forecasting platform, complete LAPM automation system, or substitute for qualified planning review.
