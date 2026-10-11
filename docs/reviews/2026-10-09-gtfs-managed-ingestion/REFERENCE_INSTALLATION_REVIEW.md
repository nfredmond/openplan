# Independent production topology boundary, October 11

The remaining installation work belongs to [M3](../../ROADMAP.md#m3-free-private-and-recoverable-agency-operation).
The current same-host CLI recovery checks do not commission an independent
agency installation. Product direction passes with existing dated review
reminders; the full v1 contract remains unchanged.

[Supabase's current manual guide](https://supabase.com/docs/guides/self-hosting/docker)
names `self-hosted/v0.8.2`. Read-only remote verification resolves that tag to
commit `564eab8ad7840b13324f68b1bfac074ef8d51c21`. Six small public files are
retained privately, with [their URLs and hashes](reference-source-inventory.json).
No installer script, image pull, service start or cloud provisioning runs.

The [pinned Compose file](https://github.com/supabase/supabase/blob/564eab8ad7840b13324f68b1bfac074ef8d51c21/docker/docker-compose.yml)
uses PostgreSQL `17.6.1.136`, Storage `1.74.0`, Auth `2.196.0` and PostgREST
`14.17`. Its default gateway is Envoy. It names the database `supabase-db` and
mounts `db-config` at `/etc/postgresql-custom`. These are source observations,
not running-service checks.

[Exact owned drill observations](reference-local-component-comparison.json)
instead record PostgreSQL `17.6.1.156`, Storage `1.67.20`, Auth `2.194.0` and
PostgREST `14.15`. The key is a read-only file bind at
`/etc/postgresql-custom/pgsodium_root.key`. Both database images use PostgreSQL
17; a shared major version does not establish matching bootstrap, gateway,
authorization, Storage behavior or recovery configuration.

The existing key helper intentionally accepts only its recorded CLI service
and regular file bind. [Source-informed synthetic probes](reference-existing-helper-reference-refusals.json)
confirm that it refuses the official Compose ownership and directory-volume
shapes. Baseline, harmless and restored CLI-shaped probes pass. Docker responses
are mocked; only a disposable synthetic file is read. This does not demonstrate
a failed native production restore, and no guard is broadened.

Continue the M3 work through a pinned production recipe and a separately
reviewed topology adapter. Before acceptance, verify fresh bootstrap and exact
OpenPlan migrations, private supervision and schedules, both demand workers,
encrypted configuration and all durable worker/object bytes on another host.
Recheck cancellation and late-upload cleanup against the selected Storage
version. Keep the default Compose names and ports out of another installation's
scope. Build identity, teammate isolation, populated upgrade and useful maps
require actual journeys. This note adds no queue or capability promotion.
