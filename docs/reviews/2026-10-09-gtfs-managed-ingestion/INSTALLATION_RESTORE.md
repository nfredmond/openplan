# Retained installation reconstruction and continuation

October 10 proof at application source `2caefd6a9a41`, with parser build `3aa44ff80155`. This drill uses the owned 403-migration candidate, existing isolated database container and installed service images. It does not use the demo.

## Coordinated capture and reconstruction

The private runner stops only the identified, labelled proof API containers after the owned app and workers stop. It refuses foreign tables, scheduled jobs, running executions, unexpected services and database clients. It does not terminate other clients. It captures the selected complete database, private Storage bytes, both worker roots, configuration and cluster-role records.

[The reconstruction record](installation-restore-reconstruction.json) compares all 373 table/materialized-relation inventories, six sequences, schema, database ownership/ACL/settings and private files. Source and restored schema hashes agree. The file comparison covers ten Storage objects, 654 original-worker files, 29 replacement-worker files and ten protected configuration files. Original databases, files and failed captures remain retained. The successful 1 GiB, swap-disabled service takes 182.949 seconds and peaks at 408.2 MiB.

The first drill stops at configuration permission comparison. A non-secret dependency-identity file has source mode 0664; extraction narrows it to 0644. Its bytes and SHA-256 agree, but the exact mode check fails. The second drill stages copied configuration with mode 0600 before capture. It preserves original bytes and permissions. The first database and captures are retained as failed evidence, without claiming a complete restore.

[Preflight controls](installation-restore-preflight-controls.json) include native scope checks, harmless changes and ten targeted refusals. [Comparison controls](installation-restore-comparison-controls.json) refuse missing relations, altered row hashes, sequence, schema or database-property differences; the Storage inventory detects a missing file. These controls establish sensitivity of the stated comparisons. They do not establish cross-host installation.

## Fresh service and worker operation

[Service rebinding](installation-restore-rebind.json) starts new Auth, REST, Storage and gateway containers using their installed image hashes, with bounded memory and swap disabled. The old containers remain stopped and retained. Only physical database URI paths and fresh gateway service names change. Logical API origin, installation identity, parser build and journal contents remain unchanged. [Service-scope controls](installation-restore-service-controls.json) cover identity, ownership, stopped-state, image, network and URI refusals.

[Native checks before worker processing](installation-restore-native-before-worker.json) verify password grants for owner, viewer and outsider fixture identities. Actual Storage downloads verify all ten retained objects against their size and SHA-256. Anonymous archive access is refused. The restored queued ZIP matches its private local source, while the original database remains queued with no claims.

[Fresh CLI completion](installation-restore-native-completion.json) processes that recovered ZIP once: 14 routes and 287 stops produce 95 route and 717 stop service rows. It leaves the version unadopted. The installed one-shot service exits successfully in 2.943 seconds, peaking at 151.3 MiB. The original database remains queued. Pre-existing version and claim records remain equal between source and restored databases.

[Native observer controls](installation-restore-native-controls.json) use actual local Auth, Storage and SQL. Six positive runs pass; eight deliberately broken identity, archive, target-database, adoption, parser-count and historical-scope checks fail at their intended assertions. Both private observer scripts return to their recorded source hashes in `finally`.

## Evidence limits

This is a complete selected-database and private-file reconstruction followed by fresh local services and worker continuation in the same physical cluster with existing roles. It does not establish whole-host or custom-role transfer, a new logical origin, current Supabase topology, browser cookie recovery, full live RLS, largest-feed capacity, scientific validity or practitioner acceptance. Raw dumps, credentials, configuration, claim tokens and source archives remain private. Production browser verification, current main integration, GitHub CI and release remain open. All four candidate migrations remain unreleased.
