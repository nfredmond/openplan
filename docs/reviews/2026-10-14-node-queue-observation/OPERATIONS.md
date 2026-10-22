# Operating Node queue observations

This is an unreleased candidate. Hosted migration 15 has not been applied. Follow the coordinated migration and deployment turn before using it in production.

1. Capture a fresh backup for the intended installation and verify its retained files.
2. Apply additive migration `20261017000015_node_queue_process_observations.sql` before deploying code that reads it. Use the installation's documented migration procedure and confirm the selected database. Do not apply to a walkthrough or test database by assumption.
3. Deploy the web build and restart the existing Node queue workers from the identified build. Their existing commands stay the same. This feature does not start a GTFS poller or any other worker that was previously off.
4. If deep health is configured, use its existing bearer token to read `/api/health/deep`. Keep the token private. `checks.nodeQueueProcesses` carries the complete census, observation time and process-only scope. The public health route does not expose these observations.

Each process records a fresh UUID and captured build. It attempts observations every 30 seconds. A request deadline is three seconds. Diagnostic failures preserve the business worker's result and produce one fixed warning for that invocation. The existing worker signal handlers control shutdown. A final stopped observation can fail during abrupt termination, so absence of a recent running observation is a reason to investigate, not proof of a clean stop.

Read the process states as follows:

| State | Meaning |
|---|---|
| `unobserved` | This installation has no retained observation for that kind. It may never have started. |
| `observed_running` | At least one instance recorded running within two minutes of the server observation time. |
| `observed_stopping` | No fresh running instance is counted, and at least one instance recorded stopping within two minutes. |
| `last_observed_stopped` | The latest retained observation records stopped, with no fresh running or stopping instance counted. This does not prove every possible process stopped. |
| `stale` | The latest non-stopped observation is older than two minutes, with no fresh running or stopping instance counted. |
| `unknown` | The latest timestamp is later than the server observation time. Investigate clock/data integrity before interpreting it. |

A failed process probe has no `queues` array. Do not replace it with zero workers. These states describe event-loop observations, not queue backlog, task progress, output quality, current job lease ownership or approval. Check those separate records when investigating work.

The client checker allows 30 seconds for the route's three serial eight-second probe budgets and response overhead. This is a caller timeout, not a business-worker deadline. Each probe keeps its own cancellation transport.

Ordinary workspace members cannot read or write the deployment-global table or its RPCs. Service credentials remain privileged. Old instance rows are retained. This candidate introduces no cleanup schedule or accepted storage-capacity limit.
