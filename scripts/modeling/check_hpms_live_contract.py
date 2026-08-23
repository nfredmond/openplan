#!/usr/bin/env python3
"""Tiny live schema probe for the pinned FHWA HPMS source.

This is scheduled evidence, not part of the offline unit suite. It requests one
small source-contract window and fails by naming schema/source drift; an empty
response is never translated into "no traffic".
"""
from __future__ import annotations

import tempfile

import hpms_count_source as hpms


# A small, previously verified window containing HPMS sections. This is a
# source-contract fixture only; no product behavior or study geography uses it.
CONTRACT_PROBE_BBOX = (-121.1, 38.5, -121.0, 38.6)


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="openplan-hpms-contract-") as cache:
        result = hpms.fetch_hpms_records(
            CONTRACT_PROBE_BBOX,
            cache,
            page_size=1_000,
            fail_on_source_error=True,
        )
    if not result["records"]:
        raise hpms.HPMSSchemaDriftError(
            "HPMS 42um-tgh5 live contract drift: the pinned window returned no roadway sections"
        )
    if result["status"] not in {"available", "no_eligible_sections", "no_traffic_found"}:
        raise hpms.HPMSSchemaDriftError(
            f"HPMS 42um-tgh5 live contract drift: unexpected status {result['status']!r}"
        )
    print(
        "HPMS live contract intact: "
        f"{len(result['records'])} selected section(s), "
        f"source update {result['source']['source_update_timestamp']}."
    )


if __name__ == "__main__":
    main()
