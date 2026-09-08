# Contributing to OpenPlan

OpenPlan welcomes improvements to practical, transparent planning work for public
agencies, tribes, communities, independent planners and consulting teams.
Start with [AGENTS.md](AGENTS.md), the repository operating entry point,
and the [architecture](docs/ARCHITECTURE.md). The full product destination is the
[v1 contract](docs/product/V1_PRODUCT_CONTRACT.md); the
[roadmap](docs/ROADMAP.md) is the only active queue.

## Before making a change

Confirm the checkout and active work. The Node application lives in `openplan/`;
workers, scientific scripts and the acceptance harness are sibling directories.
Do not change a checkout while another session gathers acceptance evidence.
Use a separate branch/checkout for independent work and preserve unrelated edits.

Trace the existing implementation and a real planner outcome before adding a
parallel capability. Report defects with reproduction, source/build identity,
expected result and actual result. Keep secrets, client records and raw agent
histories out of public issues and commits.

## Product constraints

These summarize the [canonical operating rules](docs/product/AGENT_OPERATING_RULES.md); use those links for
scientific custody, human approvals and detailed release requirements.

- **Geography is not hardcoded in core behavior.** Places and jurisdiction-specific
  data/law enter through sourced registries and adapters. Workspace home, study
  geometry and legal authority are separate facts. Unsupported is not zero.
- **OpenPlan remains free and open source.** No paid tier, payment step, required
  paid service or subscription gate. Optional implementation, administration and customization services are permitted around the same free software. Customer records and independent operation cannot depend on buying support. Check external-service terms and data rights.
- **Self-service is the destination.** Expose incomplete operator/recovery steps
  honestly; do not call a founder-assisted operation a completed agency workflow.
- **Deepen existing modules first.** A new module requires a current whole-product
  review establishing a core need without a coherent existing home. Do not shrink
  v1 to fit the current module list.
- **Migrations are additive and data-safe.** Never drop deployed data to make a
  test or upgrade easier. Explicit approval is required for destructive operations.
- **Scientific claims follow their evidence.** Preserve inconclusive and unsupported
  results, separate AequilibraE and ActivitySim, and never reopen consumed holdouts
  or alter preregistered thresholds to manufacture success.
- **Consequences require human control.** Ground facts; bind approvals to exact
  payloads; keep publication, adoption, money and claim-tier promotion accountable.

## Verification

Run app commands in `openplan/`. Start with the relevant regression tests and
prove changed guards using a harmless mutation that survives and an actual broken
behavior that fails. State what the checks cannot see. Do not inflate a baseline
or remove a test just because the suite is red.

```bash
npm ci
npm run lint
npm test
npm run qa:gate
```

The full gate includes lint, dead-code analysis,
app tests, an optional explicit RLS step, production dependency audit and build.
Live tests write fixtures. Set `OPENPLAN_RLS_GATE=1` only after selecting an
isolated test stack; ordinary `qa:gate` never starts them automatically. The
shuffled suite protects against order dependence. First-week evidence verifier
tests run inside the app suite; they do not launch browsers or prove usability.

Run `npm run test:rls-live` against an appropriately isolated test database for
permission/schema behavior. Run `npm run test:workers` for worker changes: its
runner uses each worker's own environment and reports missing environments.
Do not substitute a bare system-Python invocation across all worker families.
Read the relevant worker's instructions for engine and scientific test setup.

For visible work, use identified-checkout browser journeys from real navigation,
desktop and 390px, keyboard and console review, and inspect saved/exported
artifacts. Agent completion cannot establish professional usefulness or public
understanding. Apply actual-user observation to consequential workflow design.

Strategy-review expiry and the known partial full-journey assessment do not block
every development release. Follow the [development release policy](docs/product/DEVELOPMENT_RELEASE_POLICY.md).
Hosted deployment is deferred; Vercel is not a required check.

## Pull requests and release handoff

Branch from main and keep the outcome coherent. A review description explains
the problem, resulting behavior, verification and material limits. Follow the
[PR template](.github/PULL_REQUEST_TEMPLATE.md). Include relevant migrations and
operator changes; preserve dated studies and decisions when superseding them.

Commit and push verified checkpoints. Check GitHub Actions separately from a
successful push. A release tag needs its declared acceptance evidence and aligned
version/changelog/migrations; a package version by itself is not a release.
Record blockers and costly findings durably so another contributor can resume.

Use plain, sourced public copy. Screening evidence must not be called validated
forecasting. Do not claim that self-hosting prevents all external requests, or
that a commercial provider's personal free tier covers an agency.

## Security and rights

Follow [SECURITY.md](SECURITY.md) for disclosure. Never put credentials,
confidential tenant data or exploitable details in a public issue.
Check [LICENSE-NOTICE.md](LICENSE-NOTICE.md) before copying code, data or media;
the repository's Apache license does not relicense third-party inputs.
