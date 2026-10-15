# Hosted application queues

Build from the repository root with `docker build -f workers/hosted-node/Dockerfile .`.
The image runs seven existing Node queue workers under one supervisor. If any
queue process exits unexpectedly, including exit zero, the supervisor stops its
siblings and fails the service so the host can restart it. An operator signal
stops the service normally. The container starts the supervisor as process 1
under the node user with `setpriv`, so SIGTERM reaches it directly and workers
get up to 20 seconds to stop; the host's own stop timeout still caps that. Restart does not authorize replaying an uncertain write.

Provide the Supabase URL, publishable key, service role, canonical site URL,
integration encryption secret, and approved Resend sending key as private host
variables. Never bake them into the image. Set the existing per-worker work
directories to separate children of a persistent `/data` volume. Export,
engagement email, provider API, translation, and synthesis journals must survive
a deployment. A database backup does not include these filesystem journals.

For encryption-secret rotation, follow the staged
[self-hosting procedure](../../openplan/docs/SELF_HOSTING.md#rotate-the-integration-encryption-secret).
Prepare both secrets on every reader before changing the primary. The optional
`OPENPLAN_INTEGRATION_KEY_PREVIOUS_SECRET` reads retained ciphertext; new writes
use `OPENPLAN_INTEGRATION_KEY_SECRET`. Reads do not rewrite queued envelopes or
journals. Keep the old secret while any retained request or restore point needs
it. This support does not rotate a provider API key or replay a provider call.

`OPENPLAN_NODE_WORKERS` can select distinct supported queues by comma-separated
name. Omit it to run all seven. Unknown or duplicate names refuse startup. AI
queues still require a provider configured by the workspace; hosting the queue
does not supply an AI account or authorize its charges.

Chromium runs as the Node user with its internal sandbox disabled inside this
container. The renderer consumes server-authored report HTML. Treat this as a
container trust boundary, preserve authentication and report input escaping,
and do not use it as a general public browsing service.

The image includes Poppler's `pdftoppm`. Work-program exports use it to render
explicitly cited original PDF pages. Verify a page render in the deployed image;
Chromium availability alone does not establish this dependency.

The October 10 installation uses one CPU and at most 2 GB RAM in Railway
us-west2, one replica, automatic restart on failure and no public port. These
limits are operating settings, not a throughput guarantee. Verify actual queue
claims, saved output bytes and restart reconciliation before reporting a job as
complete. `node --test workers/hosted-node/supervise.test.mjs` verifies process
failure and shutdown behavior, not database recovery or PDF fidelity.
