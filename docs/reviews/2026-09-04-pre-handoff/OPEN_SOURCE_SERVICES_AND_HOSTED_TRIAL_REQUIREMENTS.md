# Open-source services and hosted trial requirements

Research date: September 4, 2026. Scope: the user's mid-term hosted demo/trial direction, optional implementation and annual administration services, separately scoped customization, and client control of installations. The active checkout was read-only. Sampled source identity: clean `27c22b686051dbaad30c6ca94d345a705226c72b`. No hosting was provisioned, no accounts or services changed, and no external outreach, browser acceptance or recovery test occurred. This is the sole written artifact.

## The offering

OpenPlan remains free, Apache-2.0-licensed software that a client can install, operate and modify without buying Nathaniel's services. Nathaniel can earn income by getting an installation working, administering it under an annual scope, and delivering separately agreed customization. Clients pay their own infrastructure providers or explicitly arrange infrastructure operation as part of a service. The hosted trial demonstrates the same product; it does not introduce a paid feature tier.

These are distinct commitments. An open-source release provides code and documentation. Implementation delivers an accepted installation. Administration takes responsibility for specified operating work. Customization delivers an agreed change. None implies unlimited support, free feature development or a promise of scientifically validated results before the evidence supports them.

The user has authorized this direction and documentation, not spending money, opening public access, accepting confidential client data or executing a service agreement. Keep those later actions tied to a concrete reviewed deployment and the applicable authorization.

## Evidence inventory

Inventory preceded the selected reads. The source review establishes documented requirements and implementation entry points, not successful operation.

| Source | Reviewed evidence and limits |
|---|---|
| [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0) | January 2004 license, current official publication; §§2, 4–9 read. The primary license governs the licensed work, not all client data or third-party components. |
| [Apache licensing FAQ](https://www.apache.org/foundation/license-faq.html) | Current first-party explanation of commercial use, modifications, contribution and naming. OpenPlan is not established here as an Apache Software Foundation project. |
| [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting) | Current production/development distinction, components and operator responsibilities. No provider plan or price recommendation. |
| [Supabase database backups](https://supabase.com/docs/guides/platform/backups) | Current limits of database-only recovery, particularly Storage objects. No hosted-backup purchase assumed. |
| [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) | Current documentation for an explicitly installed extension/native-host bridge, not an ordinary website ability. |
| [CISA ransomware guide](https://www.cisa.gov/stopransomware/ransomware-guide) | Official indexed guidance on offline encrypted backups and testing recovery. Full page retrieval failed; only that bounded indexed recommendation is used. |
| `LICENSE`, `LICENSE-NOTICE.md:3–9` | Repository declares Apache-2.0 coverage with stated exclusions and expressly permits commercial services without narrowing the source-code license. |
| `docs/product/AGENT_OPERATING_RULES.md`, `openplan/src/test/no-paid-tier-guard.test.ts:189–245` | Manual and guard currently contain broader commercial-language restrictions than the new direction. No tests were run or edited. |
| `openplan/docs/SELF_HOSTING.md:17–38, 516–519`, `openplan/docs/ops/RUNBOOK.md:181–228`, `openplan/docs/ops/BACKUP_AND_RESTORE.md:3–6, 37–77` | Existing deployment and recovery documentation, including database/object separation and disposable restore procedure. No recovery proof was reproduced. |
| `openplan/src/app/api/assistant/chat/route.ts:4–5, 81–99`, `openplan/src/lib/integrations/anthropic-access.ts:19–49` | Sampled assistant route authenticates a user and uses a server-side API integration; key resolution is workspace then deployment environment. This is not a complete provider/route security audit. |
| `openplan/scripts/ops/check-public-demo-preflight.mjs:7–38` | Existing origin-configured public preflight entry point. Its presence does not establish any current hosted instance or complete trial acceptance. |

## License, ownership and contribution boundaries

Apache-2.0 permits use, modification and distribution. Distributed copies must retain the license and applicable notices; modified files need change notices, and included NOTICE attributions must be handled as specified. The license allows charging for support and other additional obligations on the provider's own responsibility. It does not confer trademark rights or make other contributors responsible for a service promise. These are relevant distribution/service boundaries, not a drafted client contract. [Apache License §§2, 4, 6, 9](https://www.apache.org/licenses/LICENSE-2.0).

The FAQ confirms that modifications may be sold or kept private and need not be contributed upstream. Open contribution is therefore an invitation, not a condition invented by OpenPlan. A submitted PR needs provenance, review and product fit; submission is not a promise of merger, maintenance or delivery date. Product policy can favor reusable improvements in the public core without misrepresenting permissive-license obligations. Use "Apache-2.0-licensed OpenPlan," not wording implying Apache Software Foundation endorsement. [Apache FAQ](https://www.apache.org/foundation/license-faq.html).

The repository already distinguishes covered code from trademarks, private credentials, confidential client material, third-party data/media and some client-specific deliverables. Its notice expressly permits commercial onboarding, hosting, support and custom extensions. Preserve those distinctions during handoff. An agency receiving an installation receives the applicable software license; it does not thereby receive exclusive ownership of upstream code. Conversely, uploading a client's records does not make them open-source contributions. `LICENSE-NOTICE.md:3–9`.

For each customization, identify the deliverable, acceptance, maintainers, distribution license, third-party rights and whether upstream submission is included. Avoid a permanent client fork where configuration or a reusable contribution works. Where client-specific code remains, provide its source/build instructions and explain its upgrade responsibility. The user retains the fully free core product direction; this report does not propose proprietary restrictions on core planning work. No third-party dependency/data-license audit was performed.

## Three hosted experiences

| Experience | Purpose and data boundary | Evidence required before calling it ready |
|---|---|---|
| Public read demo | Anyone can inspect real, clearly identified public example work and results; records are intentionally published | Anonymous journeys reach the advertised examples and downloads; mutation attempts fail; private records, tokens and operator endpoints are inaccessible; examples show date, geography, provenance and scientific limits |
| Invited editable trial | A planner/team completes real product workflows in isolated disposable space using approved evaluation data | Each invitee can start, save, return, collaborate and export; a different trial cannot read or alter its work; long jobs and assistant use have actual funded/configured backends; expiry/export/reset are visible and recoverable |
| Confidential agency installation | An agency performs continuing work under its own authority and operating arrangements | Accepted identity/access configuration, public/private separation, recovery, updates, data handling, support ownership and exit handoff; real agency records enter only after those decisions |

The editable trial must become a fully functioning evaluation of the advertised product. A prerecorded walkthrough, a prepared worker payload or a refusal caused by missing configuration is insufficient. When a feature is not ready, state its limit and do not count that journey as accepted. A public read demo is useful earlier, but does not satisfy the editable-trial requirement.

Use genuinely public datasets or expressly approved evaluation material. Any deliberately synthetic training example must be unmistakably labeled; do not fabricate realistic-looking agency records to imply actual results. Trial work should have an export path before expiration. A trial expiry is an operating/data-retention event, not a software license expiration or a reason to disable the client's own installation.

Modeling remains separate from hosting maturity. Preserve AequilibraE and ActivitySim method identities, input/source custody and actual evidence states. A successfully completed job does not establish validated nationwide accuracy. Keep limitations in the run, report, assistant narration and export, not only a demo disclaimer. The binding all-50-states-and-DC, California-depth and full-planning-work ambition stays unchanged. `docs/product/AGENT_OPERATING_RULES.md`, sections "Binding v1 contract" and "Travel-model science".

## Hosting and visitor-computer reality

Supabase's current documentation explicitly says its CLI development stack is not a production self-hosted deployment and must not be exposed to external traffic. Production self-hosting uses its deployment approach and makes the operator responsible for maintenance, security, configuration, backups and monitoring. Therefore, do not publish the existing local development stack through a tunnel and call it a hosted trial. A production deployment recipe is a dependency, even for evaluation. [Supabase self-hosting](https://supabase.com/docs/guides/self-hosting).

A visitor loading a website does not give that site a native CLI on the visitor's computer. Chrome's native messaging path requires an installed native host and an extension with permission and allowed origins. That is an optional companion integration requiring explicit installation and authorization, not a zero-install browser capability. Do not assume a CLI on Nathaniel's computer or a deployment server is running on the visitor's computer. [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

For a browser-only trial, use an actual server-side API/model service or an appropriately hosted open model with a named operator, spend owner and access boundary. A future client-owned device companion can use that client's authorized provider/runtime, but must preserve approval, scoped actions and revocation. It cannot depend on shared personal subscriptions or quietly forward visitors into Nathaniel's consumer login. Provider-specific credential and subscription terms need review when choosing that integration; this report does not assert a permitted redistribution arrangement.

The current sampled assistant uses workspace or deployment API credentials. A trial must explain which source pays and isolate requests accordingly. Any operator-funded trial limits should protect shared compute and show the actual queue/refusal reason. They must not become premium feature gates or hide an unfunded backend behind a success message. Visitors should not need to give Nathaniel their personal login credentials. `openplan/src/lib/integrations/anthropic-access.ts:19–49`; `openplan/docs/SELF_HOSTING.md:225–237`.

## A sustainable service scope

The following is a proposed offering structure. It supplies no prices, legal promises or contractual language.

| Offering | Concrete work and acceptance | Scope to settle explicitly |
|---|---|---|
| Implementation | Configure the client's deployment, identity, integrations and agreed imports; train named staff; complete representative planning journeys, recovery and handoff | Included environments, migrations/data cleanup, integrations, staff sessions, acceptance datasets, accessibility checks and remedies for an unsuccessful handoff |
| Annual administration | Maintain an agreed installation; review health/backup alerts; apply tested updates; manage approved access changes; perform recovery exercises and keep operating records | Service hours, channels, severity definitions, response targets, maintenance windows, supported versions, included effort, escalation and who covers absence |
| Customization | Deliver a separately scoped change, migration and documentation with acceptance evidence and upgrade implications | Requirements, exclusions, data rights, dependencies, source/license, review rounds, change control and ongoing maintenance |
| Optional transition assistance | Move operation to the client's staff or another provider and demonstrate independent control | Export/import, account ownership, credential rotation, cutover, retained copies, deletion schedule and time-limited assistance |

A service year is not unlimited development. Distinguish a broken accepted behavior from a new requirement, an external data/provider change, user training, emergency recovery and a customization request. Set response expectations separately from guaranteed resolution. Do not promise continuous coverage that a sole operator cannot staff. Planning judgments, legal approvals, adoption, procurement publication and spending remain with the client's authorized people.

Direct client ownership of infrastructure accounts, domain, mail, backups and integration contracts is the preferred default. Give Nathaniel a named revocable administration role. If he operates infrastructure under an arrangement, record the real owner/payer and a workable transfer path. Ownership cannot be ceremonial: the client needs access to the accounts, keys or recovery processes required to continue without him.

Cost drivers to measure before a service quote include web/database resources, memory and CPU for model/OCR/report workers, geospatial/model disk growth, stored attachments, off-site backups, network transfer, map/imagery/data requests, AI usage, email delivery, monitoring/log retention and staff time. Public trials add abuse, concurrency and cleanup workload. Local hardware still consumes storage, electricity and operator attention. Free software does not make those resources unlimited or prove that a provider's free allowance fits the workload.

## Portability, recovery and staff exit

A handoff package needs more than PDF/CSV exports. Include database state and relationships; Storage bytes; source documents and licenses; project/plan/program identifiers; versions, approvals and audit history; model inputs/results and scientific evidence boundaries; deployment version and migrations; configuration inventory; and the procedure for replacing secrets. Transfer secrets only through an approved private channel, not inside a public export. Preserve enough authority and membership mapping to reconnect identities safely on the target.

Database-only recovery is incomplete where attachments live in object storage. Supabase confirms that database backups contain object metadata, not Storage objects. OpenPlan's existing backup document already separates these archives. Extend and prove that path for the actual production layout rather than starting another unrelated backup mechanism. [Supabase backups](https://supabase.com/docs/guides/platform/backups); `openplan/docs/ops/BACKUP_AND_RESTORE.md:3–6, 37–77`.

Backup success and recovery success need separate evidence. Use encrypted copies outside the primary failure domain and an actual isolated restore. CISA recommends offline encrypted backups and testing their integrity/availability. Measure observed data loss and recovery time, then agree an achievable recovery objective; do not invent an uptime percentage or recovery guarantee. `openplan/docs/ops/RUNBOOK.md:194–228`; [CISA guidance](https://www.cisa.gov/stopransomware/ransomware-guide).

Staff exit must revoke interactive sessions, privileged roles, API tokens and worker/integration credentials as applicable, transfer responsibilities and retain authored history. An agency needs a recovery administrator and a tested way to replace both a departing employee and Nathaniel. Support access should be named, limited and auditable. Do not leave a shared founder account as the only route into the installation.

For trial-to-owned installation, capture the agreed source cutoff, export and verify the package, restore into a client-controlled target, reconcile counts/hashes and relationships, rebind external services, then test representative private/public workflows. The target must not send through trial credentials, callbacks or mail addresses. The client accepts the target before the trial copy is disposed of under the agreed schedule; retained backups and any applicable hold must be accounted for. Do not treat a fresh empty installation as migration success.

## Milestone sequence and done evidence

1. **Align the product and service boundary.** Update current authorities and guards to allow truthful optional-service/trial information while continuing to reject software billing, feature/seat gates and payment-dependent self-hosting. Preserve dated history. Reconcile `LICENSE-NOTICE.md:9` with the visitor-language guard and reconsider the categorical shared-worker prohibition in `SELF_HOSTING.md:516–519`. Passing evidence must include an allowed optional-service case and rejected paid-core cases, with targeted mutations and a surviving no-op. This research does not edit them.
2. **Establish the production operating recipe.** Document the actual deployment, network, auth, worker scheduling, secret management, backup/update and cost-owner arrangements. Restore a complete installation into an isolated target; demonstrate staff removal and security-update recovery. An independent operator must be able to follow the procedure. Existing development-stack instructions and health checks alone do not pass.
3. **Publish the read demo after approval.** Complete desktop/mobile, keyboard and public/private access journeys against the actual public origin. Verify every advertised report/map and all scientific disclosures. Record origin/build identity and operating ownership. Publication approval follows a concrete reviewable deployment; this task grants none.
4. **Complete an invited editable trial.** Two separate teams complete agreed core planning work from intake to reviewed export using actual services. Test reload, interruption, simultaneous jobs, return visits, quota exhaustion, expired invitations and cross-trial access. Prove that the trial can be operated within an explicitly funded resource envelope and that expiry does not lose work silently.
5. **Prove client ownership and optional administration.** Migrate trial work into an independently controlled installation. A client administrator signs in, removes service-provider access, performs an export and restores a backup without Nathaniel. Re-enable only the agreed administration role if the client chooses that service. Record the accepted service scope and measured workload before offering annual commitments.

Register failures that must stop an acceptance claim: leaked trial data; reachable developer/admin ports; missing attachment bytes; exported approvals detached from records; scientific state promoted by demo copy; assistant using another client's key; a job only prepared but called completed; trial cleanup deleting the target; revoked staff retaining access; unsupported upgrade with no recovery route; and a handoff depending on Nathaniel's private machine. These cases are proposed future verification, not tests performed here.

## Present limitations

This review did not establish a current hosted instance, production-ready installation recipe, full trial isolation, recovery completeness, provider terms for a future CLI companion or the economics of serving a particular client. It did not verify every module or third-party license. Existing source/docs provide a base to extend, not proof of those outcomes. No prices or legal agreement were invented. Root owns architecture, roadmap placement and integration of the user's changed operating direction.
