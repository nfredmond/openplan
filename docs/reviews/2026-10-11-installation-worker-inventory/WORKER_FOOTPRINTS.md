# Worker state to assess before backup

This is a source audit of this candidate, not an inventory of Nathaniel's machine
or the hosted installation. The operator records actual configured paths and
service versions in the private profile. A source default is not evidence that
a service runs there. Retain historical state even when a worker is no longer
deployed. Database and Storage recovery remain separate from local root capture.

| Worker family | State and configuration to assess | Source |
| --- | --- | --- |
| AequilibraE | `AEQ_WORK_DIR`, complete run inputs/results, `state.json`, managed/legacy command journals and referenced model/data assets. The fallback is the system temporary directory's `openplan-model-runs`; it is not a durability guarantee. | [Main worker](../../../workers/aequilibrae_worker/main.py) |
| ActivitySim | Both `OPENPLAN_ACTIVITYSIM_BUNDLE_ROOT` and `OPENPLAN_ACTIVITYSIM_RUNTIME_ROOT`; referenced configuration, native/container runtime and supervision settings. HTTP runs allocate a separate UUID directory below the runtime root. AequilibraE's root does not imply custody of these files. | [HTTP worker](../../../workers/activitysim_worker/main.py), [runtime](../../../workers/activitysim_worker/runtime.py) |
| County onramp | Actual `OPENPLAN_REPO_ROOT`, attempt inputs/outputs under `data/screening-runs`, manifests and every referenced original/cache asset. Assess reconstructibility from retained bytes before excluding a cache. | [Worker](../../../workers/county_onramp_worker/main.py) |
| OCR | `OCR_WORKER_WORK_DIR`, persisted jobs, original sources, outputs and callback identity. The current configuration fallback is `~/.local/state/openplan/ocr-worker`; the introductory comment still names a temporary-directory default. | [Worker configuration and persistence](../../../workers/ocr_worker/main.py) |
| ODM | `ODM_WORKER_WORK_DIR`, staged downloads, callback/configuration and the separate NodeODM service/task volumes. This worker has an in-memory job registry. Capturing staged files does not establish continuation of a running NodeODM task. Retention sweeps also require assessment. | [Worker](../../../workers/odm_worker/main.py) |
| Engagement email | `OPENPLAN_ENGAGEMENT_EMAIL_WORK_DIR` and every installation partition below it, saved send outcomes and exact provider/installation configuration. Retained outcomes prevent a retry from silently becoming another send; provider-side delivery is a separate fact. | [Entrypoint](../../../openplan/scripts/workers/engagement-email.ts) |
| Document exports | `OPENPLAN_DOCUMENT_EXPORT_WORK_DIR`, retained render metadata/bytes and campaign report state, alongside immutable source revisions and output objects. | [Entrypoint](../../../openplan/scripts/workers/document-exports.ts) |
| Provider API | Actual `OPENPLAN_PROVIDER_API_WORK_DIR` or configured target-specific fallback, exact approved jobs, retained outcomes and target/provider configuration. | [Entrypoint](../../../openplan/scripts/workers/provider-api.ts) |
| Translation generation | Actual `OPENPLAN_TRANSLATION_GENERATION_WORK_DIR` or configured target-specific fallback, private jobs/outcomes and original approved source/version identity. | [Entrypoint](../../../openplan/scripts/workers/translation-generation.ts) |
| Synthesis preparation | `OPENPLAN_SYNTHESIS_PREPARATION_WORK_DIR` and target partitions, coordinator and attempt journals, exact preparation inputs and outputs. | [Service options](../../../openplan/src/lib/engagement/synthesis-preparation-service.ts) |
| GTFS ingestion | `OPENPLAN_GTFS_WORK_DIR`, queue and attempt journals, original retained ZIP bytes, parser artifacts and exact installation/build/target identity. Worker publication and planner adoption remain separate. | [Queue options](../../../openplan/src/lib/gtfs/managed-worker-queue.ts) |
| Synthesis generation | `OPENPLAN_SYNTHESIS_GENERATION_WORK_DIR`, target and authorization partitions, exact approved requests, private source/output and uncertain provider exchanges. | [Entrypoint](../../../openplan/scripts/workers/synthesis-generation.ts) |
| Synthesis execution | The same synthesis-generation root, including its target-specific queue coordinator. Record one shared root ID rather than overlapping directory selections. | [Service options](../../../openplan/src/lib/engagement/synthesis-execution-service.ts) |
| Contract calculations | The current parent/child uses database claims, source command and committed result. It declares no local durable work root. Explicitly assess database/Storage custody and configuration; do not invent a zero-byte local backup requirement or infer absence of other installed state. | [Parent](../../../openplan/scripts/workers/contract-calculations.ts), [child](../../../openplan/scripts/workers/contract-calculation-child.ts) |
| Planner Agent connector | Explicit connection configuration, paired job journal/lock directory, provider profile and retained map-package roots selected with `--runs` or the actual default. The `run` and `maps` commands have different state. Native account reauthorization and permitted credential recovery require a separate assessment. | [Executable](../../../workers/planner_agent_connector/connector.mjs), [journal library](../../../workers/planner_agent_connector/connector-worker.mjs), [map runs](../../../workers/planner_agent_connector/map-package-run.mjs) |

The catalogue binds these entrypoint bytes, the two Python npm launch wrappers
and package bytes. It refuses a new Python `main.py`, a new npm worker key or a
retargeted known npm command. It does not recursively identify every imported
library, arbitrary native helper, installed extension, scheduler, map/imagery
server, email provider or other external service. Its private assessment notes
must identify those dependencies and any remaining omissions. The complete
application, database, Storage, keys, roles, configuration and external services
still require the deployment-wide inventory and recovery procedure.

Source identification does not prove operational restart, useful long work,
scientific suitability, customer installation or public readiness. M3 requires
each worker family to operate and recover, not merely appear in this table.
