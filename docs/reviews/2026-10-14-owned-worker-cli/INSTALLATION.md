# Start an explicitly configured original worker

This candidate is an opt-in local command. The legacy worker and container command
remain unchanged. Full application delivery, native processing and independent
installation acceptance remain open. Use a separate installation and private
root for evaluation. Do not point it at the demonstration database.

Before starting, create a private absolute runtime directory and a separate
private input directory, owned by the worker account. Existing files are not
adopted by changing their permissions. Retain any original root and its journals.

Supply three files, each private (0600), with its parent directory private (0700).
No symlink component or hard-linked input is accepted. Each file must fit 64 KiB.
Canonical JSON uses UTF-8, sorted keys, compact separators and one final newline.
The existing retained_source.json_bytes helper produces those exact bytes. Do not
print the credential file while preparing or checking it.

- Configuration: the existing runtime_configuration format, including explicit
  installation/target, original credential references, application and engine
  endpoints, native engine identity/profile, source root, public artifact URL,
  daemon socket/UID, address policies and bounds. See the
  [configuration/assembly record](../2026-10-14-runtime-assembly/STATUS.md).
  A new empty root is sealed. An older unsealed root refuses; this command does
  not adopt it.
- Credentials: exactly inboundToken, application, engine and callback. Each of the
  last three is a map containing exactly its configuration's credential reference.
  The application value has exactly apiKey and bearerToken; bearerToken may be
  null. The engine value is a printable token or explicit null for an unauthenticated
  local engine. The callback and inbound values are nonempty printable tokens.
  These values stay in memory; the configuration seal contains references.
- Presets: exactly fast-preview, balanced and high-quality. Each value is a list
  of at most 128 objects with exactly name and value. Names are nonempty, unique
  and at most 128 characters. Values are strings (at most 4096 characters), finite
  numbers or booleans. The command supplies no scientific preset defaults.
  A contract request without presetId uses this file's balanced options.

From the repository root, substitute the operator's actual private paths, free
port, bind address and pending-queue bound:

```sh
python3 -B workers/odm_worker/runtime_service_cli.py \
  --root /absolute/private/runtime \
  --configuration /absolute/private/inputs/configuration.json \
  --credentials /absolute/private/inputs/credentials.json \
  --presets /absolute/private/inputs/presets.json \
  --host 127.0.0.1 --port 8086 --max-queued 4
```

The command does not read environment defaults. Optional technical bounds are
--max-connections (default 4), --max-body (default 33554432 bytes) and
--socket-timeout (default 2 seconds). These are limits, not measured capacity.
Choose the declared publicBaseUrl and external routing for this installation;
this command does not provision a proxy, TLS, DNS, model daemon or provider.

Health at /healthz means the owned HTTP process answers. It does not mean the
application authorized processing, the engine works or an output is accepted.
The authenticated processing route retains original admissions before returning.
Artifact reads use the existing guarded adapter. SIGINT or SIGTERM cancels work,
drains owned handlers and preserves the root for recovery. Stop before replacing
private inputs or rotating credentials, then restart against the same sealed
configuration and root. Changed non-secret settings refuse that root rather than
silently reinterpreting retained work. A refusal prints a fixed diagnostic and
returns 2; retain private evidence for diagnosis.
