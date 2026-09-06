# Commissioning your first OpenPlan installation

Start with the [README local setup](../../README.md), then use
[SELF_HOSTING](SELF_HOSTING.md) for configuration, worker choices, external
connections and production requirements. This checklist owns acceptance, rather
than a second install recipe. It makes no time-to-install or free-hosting promise.

The local Supabase CLI path is for evaluation. An agency production installation
requires a separately hardened deployment and evidence for the actual environment.
No complete stranger-operated production installation has been established by
this document. Mark each item **passed**, **failed**, **inconclusive** or
**not exercised**, with the evidence location. A skipped check is not a pass.
Keep secrets and private records out of shared acceptance logs.

## 1. Record the installation

- [ ] Name the operator, intended users and evaluation or production profile.
- [ ] Record the release/commit, app build identity, operating system and Node/npm
      versions. Record database, Storage and worker versions and locations.
- [ ] Identify who owns the computer, persistent storage, service configuration
      and recovery copies. Identify which ports/origins belong to this instance.
- [ ] Record enabled providers, terms, expected costs and information sent outside
      the agency, using the inventory in SELF_HOSTING. Do not assume a free tier
      is eligible for government or consultancy use.
- [ ] For production, record the hardened Supabase topology, TLS, private service
      access, supervision, monitoring and authenticated schedules. The CLI local
      stack must not be exposed to external traffic.

## 2. Establish the database and application

- [ ] Apply the selected release's migrations to the intended target before
      admitting users. Save the result and resolve unknown migration state.
      `npm start` does not perform this step.
- [ ] Configure the Supabase origin and correct public/server keys, canonical
      site origin, Auth redirects and enabled integrations. Rebuild after public
      environment changes; restart/recreate affected services as documented.
- [ ] Run `npm run doctor` from the app directory and resolve relevant findings.
      Keep its limitations: token shape and health replies do not prove a usable
      service or correct output.
- [ ] Open the application and establish that it serves the recorded checkout
      and build. Use [which-openplan.sh](../scripts/ops/which-openplan.sh) as an
      identity aid and retain the observed URL and health/build identifiers.

## 3. Complete real first-use work

Use representative, non-sensitive evaluation material first. Browser evidence
must identify the build, user role and starting entry point. Check desktop,
a narrow 390px viewport, keyboard navigation and browser console output; inspect
downloaded artifacts as well as the page.

- [ ] Create the first account and workspace through the public entry point.
      Set the workspace geography and confirm that maps and applicable planning
      context correspond to the selected place. Record unavailable sources;
      setting a geography alone does not establish regulatory or data coverage.
- [ ] Save a real project or plan, attach evidence, leave the page and reopen it.
      Sign out and in again, and confirm the same work remains available.
- [ ] Invite a colleague, accept the invitation, and test the intended role's
      allowed work and denied actions. Test password reset separately. Record
      whether application invitations are emailed or passed as copyable links.
- [ ] Use a separate workspace and unaffiliated account to test private record,
      attachment and direct-link isolation. For schema/auth changes, run the
      documented live RLS checks against an explicitly selected disposable test
      target. Green unit tests alone do not establish deployment isolation.
- [ ] Publish only approved evaluation content through the engagement workflow.
      Check the public view, private/public boundaries and submission result.
- [ ] Produce and reopen an export or decision package. Check source references,
      selected geography, result states, content and any PDF fallback disclosure.

## 4. Prove each enabled service

- [ ] Confirm the current Mapbox map surfaces load and review their console/network
      errors. Confirm actual required Census/source retrieval for your geography.
- [ ] For each required worker, start a job through its user-facing entry point;
      observe authenticated dispatch, progress, result delivery, saved output
      and artifact access after reopening the application. County-onramp and
      the paired demand-model pollers are separate services.
- [ ] Keep AequilibraE and ActivitySim execution and validation evidence separate.
      Record preflight-only ActivitySim as such. A completed job is not proof of
      scientific validity, and a prepared county job is not an executed model.
- [ ] For OCR or aerial processing, inspect the returned document/imagery and
      evidence. Confirm configured language data, callback acceptance and storage.
      For AI actions, confirm the enabled provider and material transmitted.
- [ ] In a disposable environment, interrupt a representative long-running job
      and observe restart/retry/reaper behavior without losing or mislabeling
      the result. Capture unresolved heartbeat, stale-write or custody failures.
- [ ] Verify all three authenticated maintenance schedules from SELF_HOSTING,
      including their effects and failed-delivery reporting.

## 5. Establish recovery and an upgrade path

- [ ] Follow [BACKUP_AND_RESTORE](ops/BACKUP_AND_RESTORE.md). Inventory database,
      Storage bytes, required local artifacts, secrets/configuration and versions.
      Establish consistency across writers and record the recovery point.
- [ ] Run the representative disposable restore drill when appropriate. Preserve
      its exact scope; it does not restore the full database/Storage archives.
- [ ] Restore the actual deployment backup into an isolated target. Check roles,
      authentication, tenant boundaries, object and local-artifact hashes, and
      reopened planner work. Record elapsed recovery time and unresolved gaps.
- [ ] Rehearse the proposed upgrade on populated data before changing the agency
      instance. Record migration compatibility and the tested recovery route;
      replacing app code does not reverse database migrations.

## Acceptance record

Keep one concise record with the exact version/environment, evidence links,
results of each relevant item, observed limitations and responsible operator.
A local evaluation can be useful while production remains unproved. Production
acceptance requires evidence for its actual topology, permitted data, recovery
objectives and user workflows. Do not substitute a readiness panel, health check,
CI badge or this completed checklist for the underlying observations.
