# OpenPlan

OpenPlan is free and open-source transportation and land-use planning software,
maintained by Nat Ford Planning & Analysis. It brings projects, place-based
evidence, analysis, plans, public engagement, reports and implementation records
into one application. The source license is Apache-2.0.

The product is under active development. Version 0.44 ships OWP and engagement
improvements and repairs the local Control updater under the
[development release policy](docs/product/DEVELOPMENT_RELEASE_POLICY.md).
The September 6 acceptance record remains nine of twelve journeys passed and
three partial; this release does not claim a complete campaign pass or validated
forecasts. See the [historical outcome record](docs/ops/V044_FINAL_FIRST_WEEK_OUTCOMES_2026-09-06.md)
and [release verification](docs/reviews/2026-09-07-control-release/VERIFICATION.md).
The [v1 contract](docs/product/V1_PRODUCT_CONTRACT.md)
sets the full destination: core planning practice across all 50 states and DC,
California as the deepest implementation, and separately validated AequilibraE
and ActivitySim outputs for every claimed nationwide use. The
[capability assessment](docs/product/US_PLANNING_CAPABILITY_MATRIX.md) records what
is partial or unassessed today. A configured screen is not proof of a complete
planning job or legal sufficiency.

## What exists

| Planning work | Existing foundations | Present boundary |
|---|---|---|
| Organize and deliver work | Projects, milestones, decisions, documents, programs, grants and reimbursement records | Complete cross-agency handoff and closeout still need broader proof |
| Understand a place | GIS intake, corridor analysis, source registries and safety evidence | Coverage, units and completeness vary by source and geography |
| Prepare plans and alternatives | Land-use plans, RTP workrooms, scenarios, comparison and reports | Legal applicability and plan-kind rules have known gaps |
| Engage the public | Campaigns, surveys, mapped comments, moderation and public portals | Agent testing does not establish accessibility, representativeness or public understanding |
| Model transportation | AequilibraE and ActivitySim workers, separate results and scientific custody | Nationwide independent accuracy is unknown; inconclusive studies do not validate a use |
| Review and share evidence | Human approvals, reports, selected evidence and export packages | Some cross-module layers and workbook fields do not yet round-trip |
| Assist planning work | Grounded assistant and reviewable actions | Cloud AI is optional; consequential facts, publication, adoption and money remain human-controlled |

Read the [known limitations](docs/ops/KNOWN_ISSUES.md) before relying on an output.
The [changelog](CHANGELOG.md) describes development changes; release tags, CI and
acceptance records establish a release's actual status.

OpenPlan has no paid tier or payment step. Reimbursement invoicing is an agency
billing its funder; it is not an OpenPlan subscription. Optional external services
can charge for their use. An open-source license does not make every hosting,
map, email or AI provider free.

## Running OpenPlan on one computer

This is a **local evaluation** path using Linux, Node and the Supabase CLI.
It is not a production internet deployment. Supabase describes its CLI stack as
development/testing infrastructure; use its separate self-hosting architecture
when designing production operation. [Supabase guidance](https://supabase.com/docs/guides/self-hosting).

The September 2026 review did not establish a complete, independently installed,
free agency deployment. [Self hosting](openplan/docs/SELF_HOSTING.md) describes
implemented components, configuration and the remaining proof. Windows and
macOS users can be browser clients of a properly configured agency server; this
guide does not claim an independently verified native installation on either.

### 1. Install prerequisites

Install Git, **Node.js 24** and a working Docker Engine with Compose. Use the
[Node installer guidance](https://nodejs.org/en/download) and
[Docker Engine installation guide](https://docs.docker.com/engine/install/ubuntu/)
for your operating system. CI uses Node 24. Check available disk before downloading
containers, imagery or model inputs; those can occupy many gigabytes.

Docker Desktop is a separate product and requires a paid subscription for
government entities. Do not assume that its personal-use allowance covers an
agency. [Docker subscription terms](https://docs.docker.com/subscription-billing/desktop-license/).

```bash
node --version
git --version
docker info
docker compose version
```

Node should report version 24. `docker info` must reach the running daemon;
the presence of a Docker executable alone does not establish that.

### 2. Get the application

```bash
git clone https://github.com/nfredmond/openplan.git
cd openplan/openplan
npm ci
```

There are two directories named `openplan`: the repository and the application
inside it. Run the following commands from the application directory. `npm ci`
uses the committed dependency lockfile. Review installation errors rather than
assuming that every warning is harmless.

### 3. Start the local database and configure the application

```bash
npm exec -- supabase start
cp .env.example .env.local
```

The copy command is for a fresh checkout; preserve an existing settings file.
The Supabase command downloads and starts local services. Transfer its local API
URL and keys into `.env.local` privately:

| Setting | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Local API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-facing local anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only service key; never share or commit it |
| `NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN` | Public map token for the current map implementation |

The current maps depend on Mapbox. Missing or rejected configuration can leave
maps unavailable. Review its [usage and pricing](https://docs.mapbox.com/accounts/guides/pricing/)
before enabling it; a fully useful map setup without an external provider remains
roadmap work. The settings example documents optional services and worker keys.
Do not paste credentials into issues, screenshots or chat.

### 4. Apply migrations and start the app

```bash
npm exec -- supabase migration up --local
npm run doctor
npm run dev
```

Use the URL printed by the dev server, normally port 3000 in an
unused checkout. For the checked-in local Auth callbacks, open
`http://127.0.0.1:3000` and set the same canonical site origin. If using another
port or origin, configure and test its Auth redirects too. On a shared computer, confirm which checkout owns a port before
opening or changing it. Create an account and workspace, choose the intended
geography and inspect the source-readiness disclosures. Check that records persist
after reopening a page. A healthy doctor result is useful setup evidence, not a
completed planner-workflow test.

`npm run dev` also attempts pending local migrations before starting Next.js.
Do not use a database reset to apply an ordinary upgrade: it destroys local work.
Stop only the process you started with Ctrl+C. Keep the database available when
starting the application again.

### 5. Add the workers needed for your job

Core record keeping does not require a demand-model run. County runs, paired
demand methods, OCR and aerial processing use distinct workers and configuration.
Follow the [worker table and setup order](openplan/docs/SELF_HOSTING.md), configuring
tokens before starting the relevant service. `npm run modeling:up` starts the
county-onramp stack; it does not establish that every worker is operational.

A county/model run may take hours or days. That can be justified for accuracy,
but silence, an unchecked status write or a failed recovery is still a defect.
Inspect the declared claim tier and scientific evidence before reusing numbers.
There is no independent nationwide accuracy claim today.

## Data and privacy

Self-hosted records can remain in your chosen database and storage, but using
OpenPlan can make external requests. Maps contact Mapbox; the imported-layer
placement preview sends the layer's extent to its Static Images service. Data
adapters query their providers. Optional cloud AI, email, translation and imagery
processing can send the content required by those features. This is not a
claim that an entire GIS file is uploaded to Mapbox.

Review the [configuration and outbound-service inventory](openplan/docs/SELF_HOSTING.md)
before using confidential material. Workspace RLS is a meaningful control;
fine-grained confidentiality, public-record policies and full recovery still
need the evidence named in the roadmap.

## Documentation and contribution

- [Documentation index](docs/README.md): current authorities and dated records.
- [Technical review](docs/reviews/TECHNICAL_PRODUCT_REVIEW_2026-09-06.md): consolidated findings and evidence limits.
- [Architecture](docs/ARCHITECTURE.md): app, database, workers and data flows.
- [Roadmap](docs/ROADMAP.md): prioritized outcomes and definitions of done.
- [Team commissioning](openplan/docs/FIRST_DEPLOYMENT.md) and
  [operations runbook](openplan/docs/ops/RUNBOOK.md).
- [Reading an adopted plan](openplan/docs/READING_AN_ADOPTED_PLAN.md): existing
  document-to-plan workflow and its citations.
- [Contributing](CONTRIBUTING.md), [agent instructions](AGENTS.md) and
  [security reporting](SECURITY.md).

The app is in `openplan/`; Python workers in `workers/`; scientific/operator
scripts in `scripts/`; acceptance tools in `qa-harness/`; schemas in `schemas/`.
The [license](LICENSE) and [license notice](LICENSE-NOTICE.md) identify reuse
rights. Third-party data, media, software, trademarks and confidential records
retain their own rights and restrictions.
