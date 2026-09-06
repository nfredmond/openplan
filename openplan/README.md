# OpenPlan application package

This directory contains the Next.js application, API routes, app tests and
Supabase migrations. Start with the repository [README](../README.md) for local
evaluation and current product limits. [AGENTS.md](../AGENTS.md) is the shared
operating entry point; [Contributing](../CONTRIBUTING.md) explains verification.

Run app commands here, after configuring the intended local environment:

```bash
npm ci
npm run dev
npm run lint
npm test
npm run qa:gate
```

`npm run dev` applies pending local migrations before starting. `npm run build`
builds the app; `npm start` serves a completed build without provisioning the
database, workers or scheduler. Do not start either against another session's
acceptance checkout.

See [Self hosting](docs/SELF_HOSTING.md) for configuration and unfinished agency
deployment proof, [Architecture](../docs/ARCHITECTURE.md) for component boundaries,
and the [documentation index](../docs/README.md) for product/research references.
The repository [license](../LICENSE) and [license notice](../LICENSE-NOTICE.md)
govern reuse; optional services and third-party data retain their own terms.
