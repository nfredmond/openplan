# Security Policy

OpenPlan handles planning records, engagement inputs, workspace membership, and operational logs. Treat security issues as user-trust issues, not just code defects.

## Reporting a vulnerability

Use GitHub private vulnerability reporting if the repository offers it. The September 6, 2026 repository-settings check found it disabled; a dependable private intake channel remains an open operations task. Until a private channel is available, open an issue containing only a request for private contact and a safe way to reach you. Do not include exploitable details, credentials, tenant data or proof-of-concept payloads in a public issue. Maintainers must arrange private exchange before collecting the report.

Repository maintainers handle upstream reports. Optional implementation or administration agreements have their own support scope; installing the free software does not create a response-time or security-service commitment.

Include, when safe:

- affected route, package, or workflow;
- reproduction steps using non-sensitive data;
- observed impact;
- whether workspace data, authentication, storage, or public engagement surfaces are involved.

## Scope

Security review should cover:

- authentication and workspace isolation;
- Supabase row-level security and service-role boundaries;
- public engagement submissions and moderation flows;
- file uploads, exports, generated reports, and storage buckets;
- AI-assisted workflows where prompts or outputs may contain user data.

## Self-hosted deployments

If you self-host OpenPlan, platform configuration (Supabase keys, service-role secrets, storage
bucket policies, allowed redirect URLs) is your deployment's responsibility. A vulnerability in
OpenPlan's code belongs here; a misconfigured deployment does not — but if the default
configuration made the misconfiguration easy, that is a valid report too.

## License

The OpenPlan source code is Apache-2.0 unless otherwise marked. See `LICENSE` and
`LICENSE-NOTICE.md`.
