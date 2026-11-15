"""Independent arithmetic check of the preregistered progression decision."""
import json
from pathlib import Path
import sys


def validate(value):
    assert value["scientific_accuracy"] == "inconclusive"
    assert value["method"] == "aequilibrae"
    assert not any(value[k] for k in ("defaults_changed", "holdout_accessed", "methods_averaged"))
    for case in value["geographies"]:
        b, c = (case["scores"][a] for a in ("baseline", "candidate"))
        assert b["matched_identity_sha256"] == c["matched_identity_sha256"]
        assert b["county"]["stations"] == c["county"]["stations"]
        assert c["county"]["uncertainty_status"] == "unavailable"
        improvement = b["county"]["median_ape"] - c["county"]["median_ape"]
        passed = improvement >= (5 if case["split"] == "evaluation" else -1)
        passed &= all(row["stations"] < 5 or c["road_classes"][kind]["median_ape"] - row["median_ape"] <= 1
                      for kind, row in b["road_classes"].items())
        passed &= case["audit"]["external_distribution"]["changed_cells"] > 0
        passed &= not any(r in case["reasons"] for r in ("lost_loaded_station", "missing_matched_stations"))
        passed &= all(record["convergence"]["converged"] for record in case["assignments"].values())
        passed &= case["repeat_median_ape_delta"] is None or case["repeat_median_ape_delta"] <= 0.1
        assert (case["decision"] == "advance") == passed
        assert bool(case["reasons"]) == (case["decision"] == "retire")
    accepted = all(case["decision"] == "advance" for case in value["geographies"])
    assert (value["decision"] == "accepted") == accepted
    assert value["development_decision"] == ("advance" if accepted else "retire")


if __name__ == "__main__":
    validate(json.loads(Path(sys.argv[1]).read_text()))
