# Security Policy

OpenPlan handles planning records, engagement inputs, workspace membership, and operational logs. Treat security issues as user-trust issues, not just code defects.

## Reporting a vulnerability

Report suspected vulnerabilities privately via **GitHub Security Advisories** on this repository
(`Security` tab → `Report a vulnerability`). If private reporting is unavailable to you, open a
GitHub issue that says only that you have a security report and how to reach you — never publish
exploitable details, credentials, tenant data, or proof-of-concept payloads in a public issue.

There is no vendor and no support contract behind OpenPlan; reports are handled by the
maintainers through the repository.

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
