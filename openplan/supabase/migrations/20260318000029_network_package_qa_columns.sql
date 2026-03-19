-- P1A.3: Add QA report and file hash columns to network_package_versions

alter table public.network_package_versions
  add column if not exists qa_report_json jsonb default null,
  add column if not exists file_hash text default null;

comment on column public.network_package_versions.qa_report_json is 'Automated QA check results from the ingestion pipeline';
comment on column public.network_package_versions.file_hash is 'SHA-256 hash of the primary network bundle for integrity verification';
