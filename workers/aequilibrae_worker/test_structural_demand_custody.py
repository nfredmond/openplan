#!/usr/bin/env python3
"""Fail-closed worker custody tests for structural demand diagnosis."""
from __future__ import annotations

import hashlib
import tempfile
from pathlib import Path
from unittest.mock import patch

import main
import model_structural_input_audit as audit_core
import model_validation_structural_diagnosis_v3 as diagnosis_core


def fixture_records() -> tuple[dict, dict]:
    audit = {
        "schema": audit_core.AUDIT_SCHEMA,
        "audit_id": "audit-1",
        "geography": {"adapter": "county_fips", "id": "99999"},
        "method": "aequilibrae",
        "model_output_bytes_read": False,
    }
    audit_bytes = audit_core.canonical_json(audit).encode()
    diagnosis = {
        "schema": diagnosis_core.DIAGNOSIS_SCHEMA,
        "diagnosis_id": "diagnosis-1",
        "method": "aequilibrae",
        "scientific_outcome": "inconclusive",
        "bindings": {"input_audit_sha256": hashlib.sha256(audit_bytes).hexdigest()},
        "limitations": ["Structural diagnosis only."],
    }
    return audit, diagnosis


def test_failed_transaction_is_visibly_scientifically_unchecked():
    audit, diagnosis = fixture_records()
    with tempfile.TemporaryDirectory() as temp_dir, \
         patch.object(main.model_structural_input_audit, "validate_structural_input_audit"), \
         patch.object(main, "upload_immutable_structural_demand_json", return_value="storage://exact"), \
         patch.object(main, "sb_record_modeling_structural_demand_diagnosis", side_effect=RuntimeError("transaction refused")):
        result = main.persist_structural_demand_diagnosis_records(
            run_id="run-1", stage_id="stage-1", workspace_id="workspace-1",
            record_dir=str(Path(temp_dir) / "records"), audit=audit, diagnosis=diagnosis,
        )
    assert result["scientific_check"] == "scientifically_unchecked"
    assert result["custody_write"] == "structural demand evidence write failed"
    assert "transaction refused" in result["custody_write_error"]
    assert any("scientifically unchecked" in item for item in result["diagnosis"]["limitations"])


if __name__ == "__main__":
    test_failed_transaction_is_visibly_scientifically_unchecked()
    print("structural demand custody: all tests passed")
