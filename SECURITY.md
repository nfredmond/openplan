# Security Policy

OpenPlan handles planning records, engagement inputs, workspace membership, billing events, and operational logs. Treat security issues as client-trust issues, not just code defects.

## Reporting a vulnerability

Please report suspected vulnerabilities privately to Nat Ford Planning through an established project contact or the active managed-hosting/support channel. Do not publish exploitable details, credentials, tenant data, or proof-of-concept payloads in a public issue.

Include, when safe:

- affected route, package, or workflow;
- reproduction steps using non-sensitive data;
- observed impact;
- whether workspace data, authentication, billing, storage, or public engagement surfaces are involved.

## Scope

Security review should cover:

- authentication and workspace isolation;
- Supabase row-level security and service-role boundaries;
- public engagement submissions and moderation flows;
- hosted workspace billing/webhook infrastructure;
- file uploads, exports, generated reports, and storage buckets;
- AI-assisted workflows where prompts or outputs may contain client data.

## License and hosted-service boundary

The OpenPlan source code is Apache-2.0 unless otherwise marked. Nat Ford managed hosting, support, and implementation services may add operational safeguards, service-level expectations, and private client-specific configuration that are not part of the open-source license grant.
