"""Synthetic-only acceptance cases. No repository data or model imports."""
from __future__ import annotations

import copy
import hashlib
import json
import unittest
from dataclasses import replace

from model_validation_acceptance import AcceptanceRefused, FrozenRecord, LEVELS, METHODS, evaluate_acceptance


def fixture():
    digest = lambda name: hashlib.sha256(name.encode()).hexdigest()
    basis = dict(zip(("year", "day", "period", "direction", "lanes", "vehicle", "unit", "quantity"),
                     ("2040", "weekday", "daily", "both", "all", "vehicles", "vehicles/day", "weekday traffic")))
    shared = {key: digest(key) for key in ("network", "population", "scenario", "match_audit", "interval_method")}
    protocol = {
        "schema": "openplan.acceptance-protocol.v1", "status": "frozen", "study_id": "synthetic-only",
        "frozen_at": "2040-01-01T00:00:00+00:00", "methods": list(METHODS),
        "shared_context": shared, "method_context": {m: digest(m) for m in METHODS},
        "interval_aggregation": "weighted_envelope", "jurisdictions": ["place-alpha", "place-beta"],
        "archetypes": ["rural", "urban"], "uses": ["screening", "replication"],
        "cells": [], "blocks": [], "observations": [], "gates": [],
    }
    observations = []
    for place, archetype in zip(protocol["jurisdictions"], protocol["archetypes"]):
        for index, center in enumerate((100.0, 200.0)):
            identifier = f"{place}-{index}"
            protocol["blocks"].append({"id": identifier, "partition": "acceptance", "clusters": [identifier]})
            protocol["observations"].append({"id": identifier, "lineage": identifier, "block": identifier,
                "cluster": identifier, "jurisdiction": place, "archetypes": [archetype], "source_sha256": digest(identifier), "basis": basis.copy()})
            observations.append({"id": identifier, "observed": center, "lower": center - 10, "upper": center + 10,
                "source_sha256": digest(identifier), "interval_evidence_sha256": digest(identifier + "interval"),
                "interval_method": shared["interval_method"], "grade": "A", "qa_passed": True, "match_status": "matched", "basis": basis.copy()})
        for use in protocol["uses"]:
            cell = f"{place}/{use}"
            protocol["cells"].append({"id": cell, "jurisdiction": place, "archetype": archetype, "use": use})
            for level in LEVELS:
                members = {f"{place}-{i}": 1 for i in range(2)}
                groups = [{"id": k, "members": {k: v}, "quantity": "daily vehicles", "weight_basis": "identity", "tolerance_percent": 20} for k, v in members.items()] if level == "link" else [{"id": level, "members": members, "quantity": "sum of frozen counts", "weight_basis": "unit weights"}]
                protocol["gates"].append({"id": f"{cell}/{level}", "cell": cell, "level": level, "metric": "max_raw_ape",
                    "operator": "le", "threshold": 20, "source": "synthetic test rule, not scientific guidance",
                    "source_quote": "Synthetic tolerance only", "sample_size_basis": "Synthetic two-cluster fixture",
                    "minimum_independent_clusters": 2, "groups": groups})
    protocol["blocks"].extend([{"id": "development", "partition": "development", "clusters": ["development"]},
                                {"id": "selection", "partition": "selection", "clusters": ["selection"]}])
    outputs = {m: {"method": m, "shared_context": copy.deepcopy(shared), "method_context": protocol["method_context"][m],
                    "values": {r["id"]: r["observed"] for r in observations}, "basis": {r["id"]: copy.deepcopy(basis) for r in observations}} for m in METHODS}
    return protocol, observations, outputs


def frozen(protocol):
    payload = json.dumps(protocol, allow_nan=False).encode()
    record = FrozenRecord(protocol["study_id"], hashlib.sha256(payload).hexdigest(), protocol["frozen_at"])
    ledger = {b["id"]: {"status": "sealed", "consumed": False, "exposed": False, "study_id": record.study_id,
                         "preregistration_sha256": record.sha256} for b in protocol["blocks"] if b["partition"] == "acceptance"}
    return payload, record, ledger


def run(protocol, observations, outputs):
    return evaluate_acceptance(*frozen(protocol), observations, outputs)


def set_path(value, path, replacement):
    for key in path[:-1]:
        value = value[key]
    value[path[-1]] = replacement


# Every deliberate protocol defect is refrozen only in synthetic memory so it
# reaches its own check, rather than dying at the outer hash check.
PROTOCOL_REFUSALS = [
    ("unfrozen", ("status",), "draft", "unsupported or unfrozen preregistration"),
    ("identity", ("study_id",), "", "frozen record identity differs"),
    ("time", ("frozen_at",), "bad", "invalid freeze time"),
    ("timezone", ("frozen_at",), "2040-01-01", "freeze time requires a timezone"),
    ("methods", ("methods",), ["average"], "both methods must remain separate"),
    ("shared", ("shared_context", "network"), "", "shared input custody missing"),
    ("method_context", ("method_context", "aequilibrae"), "", "method code/settings custody missing"),
    ("interval_aggregation", ("interval_aggregation",), "independent-normal", "unsupported interval aggregation"),
    ("jurisdictions_empty", ("jurisdictions",), [], "required jurisdictions missing or duplicate"),
    ("jurisdictions_duplicate", ("jurisdictions",), ["place-alpha", "place-alpha", "place-beta"], "required jurisdictions missing or duplicate"),
    ("cells_empty", ("cells",), [], "required cells missing"),
    ("cell_duplicate", ("cells", 1, "use"), "screening", "duplicate claim cell"),
    ("cell_scope", ("cells", 0, "jurisdiction"), "outside", "cell outside declared scope"),
    ("jurisdiction_scope", ("jurisdictions",), ["place-alpha", "place-beta", "place-gamma"], "jurisdiction/use scope omitted"),
    ("archetype_scope", ("archetypes",), ["rural", "urban", "remote"], "archetype/use scope omitted"),
    ("partition", ("blocks", 0, "partition"), "unknown", "invalid partition"),
    ("overlap", ("blocks", 4, "clusters"), ["place-alpha-0"], "geographic/source cluster overlaps partitions or blocks"),
    ("lineage", ("observations", 1, "lineage"), "place-alpha-0", "duplicate source lineage"),
    ("development", ("blocks", 0, "partition"), "development", "observation is not in an acceptance block"),
    ("cluster", ("observations", 0, "cluster"), "elsewhere", "observation cluster differs from block"),
    ("observation_scope", ("observations", 0, "jurisdiction"), "elsewhere", "observation outside declared scope"),
    ("source", ("observations", 0, "source_sha256"), "", "source artifact hash missing"),
    ("basis", ("observations", 0, "basis", "year"), "unknown", "comparison basis missing"),
    ("gate", ("gates", 0, "metric"), "national_median", "unsupported gate"),
    ("threshold_type", ("gates", 0, "threshold"), True, "invalid threshold"),
    ("operator", ("gates", 0, "operator"), "ge", "metric operator has wrong direction"),
    ("threshold_domain", ("gates", 0, "threshold"), -1, "threshold outside metric domain"),
    ("source_quote", ("gates", 0, "source_quote"), "", "gate evidence missing"),
    ("sample_minimum", ("gates", 0, "minimum_independent_clusters"), 0, "invalid evidence minimum"),
    ("group_empty", ("gates", 0, "groups", 0, "members"), {}, "empty comparison group"),
    ("weight", ("gates", 0, "groups", 0, "members", "place-alpha-0"), -1, "invalid member or weight"),
    ("double_count", ("gates", 0, "groups", 1, "members"), {"place-alpha-0": 1}, "gate double counts a source observation"),
    ("link_sum", ("gates", 0, "groups", 0, "members", "place-alpha-0"), 2, "link gate must retain individual observations"),
    ("borrow_stratum", ("gates", 0, "groups", 0, "members"), {"place-beta-0": 1}, "gate borrows another stratum"),
    ("mixed_basis", ("observations", 1, "basis", "period"), "hourly", "aggregation mixes comparison bases"),
    ("quantity", ("gates", 0, "groups", 0, "quantity"), "", "aggregation quantity or weight basis missing"),
]


class AcceptanceTests(unittest.TestCase):
    def test_all_gates_pass_harmless_order_and_labels(self):
        p, o, m = fixture()
        result = run(p, o, m)
        self.assertEqual(result["outcome"], "pass")
        self.assertEqual(len(result["methods"]["aequilibrae"]["gates"]), 20)
        for method in METHODS:
            self.assertTrue(all(g["outcome"] == "pass" for g in result["methods"][method]["gates"]))
        o.reverse()
        p["gates"][0]["source_quote"] += " Harmless annotation."
        self.assertEqual(run(p, o, m)["outcome"], "pass")

    def test_hash_refusal_before_input_access(self):
        p, o, m = fixture()
        payload, record, ledger = frozen(p)
        class Unreadable:
            def __iter__(self):
                raise AssertionError("outcome input accessed")
        with self.assertRaisesRegex(AcceptanceRefused, "preregistration hash differs"):
            evaluate_acceptance(payload + b" ", record, ledger, Unreadable(), m)

    def test_record_identity(self):
        p, o, m = fixture()
        payload, record, ledger = frozen(p)
        with self.assertRaisesRegex(AcceptanceRefused, "frozen record identity differs"):
            evaluate_acceptance(payload, replace(record, study_id="another"), ledger, o, m)

    def test_duplicate_json(self):
        p, o, m = fixture()
        payload, record, ledger = frozen(p)
        payload = payload[:-1] + b', "status": "frozen"}'
        record = replace(record, sha256=hashlib.sha256(payload).hexdigest())
        with self.assertRaisesRegex(AcceptanceRefused, "duplicate JSON key"):
            evaluate_acceptance(payload, record, ledger, o, m)

    def test_not_object(self):
        with self.assertRaisesRegex(AcceptanceRefused, "preregistration must be an object"):
            evaluate_acceptance(b"[]", FrozenRecord("s", hashlib.sha256(b"[]").hexdigest(), "t"), {}, [], {})

    def test_malformed(self):
        for payload in (b"{", b'{"x": NaN}', b"{}"):
            with self.subTest(payload=payload), self.assertRaises(AcceptanceRefused):
                evaluate_acceptance(payload, FrozenRecord("s", hashlib.sha256(payload).hexdigest(), "t"), {}, [], {})

    def test_holdout_refusal_before_input_access(self):
        for key, value in (("consumed", True), ("exposed", True), ("status", "unknown"), ("consumed", None), ("exposed", None)):
            p, o, m = fixture()
            payload, record, ledger = frozen(p)
            ledger["place-alpha-0"][key] = value
            class Unreadable:
                def __iter__(self):
                    raise AssertionError("outcome input accessed")
            with self.subTest(key=key, value=value), self.assertRaisesRegex(AcceptanceRefused, "holdout is consumed, exposed, or not proven sealed"):
                evaluate_acceptance(payload, record, ledger, Unreadable(), m)

    def test_holdout_binding(self):
        p, o, m = fixture()
        payload, record, ledger = frozen(p)
        ledger["place-alpha-0"]["preregistration_sha256"] = "0" * 64
        with self.assertRaisesRegex(AcceptanceRefused, "holdout custody belongs to another frozen study"):
            evaluate_acceptance(payload, record, ledger, o, m)

    def test_missing_custody(self):
        p, o, m = fixture()
        payload, record, ledger = frozen(p)
        del ledger["place-alpha-0"]
        with self.assertRaisesRegex(AcceptanceRefused, "holdout is consumed"):
            evaluate_acceptance(payload, record, ledger, o, m)

    def test_dropped_manifest_observation(self):
        p, o, m = fixture()
        for gate in p["gates"]:
            if gate["cell"] == "place-alpha/screening" and gate["level"] == "link":
                gate["groups"].pop()
        with self.assertRaisesRegex(AcceptanceRefused, "link gate drops registered observations"):
            run(p, o, m)

    def test_tolerance_required(self):
        p, o, m = fixture()
        p["gates"][0].update(metric="share_within_tolerance", operator="ge", threshold=75)
        p["gates"][0]["groups"][0]["tolerance_percent"] = -1
        with self.assertRaisesRegex(AcceptanceRefused, "link tolerance missing"):
            run(p, o, m)

    def test_duplicate_observation(self):
        p, o, m = fixture()
        with self.assertRaisesRegex(AcceptanceRefused, "unexpected or duplicate observation"):
            run(p, o + [o[0]], m)

    def test_unknown_method(self):
        p, o, m = fixture()
        m["average"] = m["activitysim"]
        with self.assertRaisesRegex(AcceptanceRefused, "unknown or averaged method"):
            run(p, o, m)

    def test_missing_method_cannot_borrow(self):
        p, o, m = fixture()
        del m["activitysim"]
        result = run(p, o, m)
        self.assertEqual(result["methods"]["aequilibrae"]["outcome"], "pass")
        self.assertEqual(result["methods"]["activitysim"]["outcome"], "inconclusive")
        self.assertEqual(result["outcome"], "inconclusive")

    def test_missing_stratum(self):
        p, o, m = fixture()
        result = run(p, o[:2], m)
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertEqual([c["outcome"] for c in result["methods"]["aequilibrae"]["cells"]], ["pass", "pass", "inconclusive", "inconclusive"])
        self.assertIn("missing observation", result["methods"]["aequilibrae"]["gates"][10]["reasons"][0])

    def test_missing_level(self):
        p, o, m = fixture()
        p["gates"] = [g for g in p["gates"] if g["level"] != "state"]
        result = run(p, o, m)
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertIn("missing state gate", result["methods"]["aequilibrae"]["cells"][0]["reasons"])

    def test_uncertainty_only_cannot_pass(self):
        p, o, m = fixture()
        for gate in p["gates"]:
            gate["metric"] = "max_excess_ape"
        result = run(p, o, m)
        self.assertEqual(result["outcome"], "inconclusive")
        self.assertIn("missing link raw-error gate", result["methods"]["aequilibrae"]["cells"][0]["reasons"])

    def test_local_failure_cannot_be_hidden(self):
        p, o, m = fixture()
        m["aequilibrae"]["values"].update({"place-alpha-0": 150, "place-alpha-1": 150})
        result = run(p, o, m)
        gates = result["methods"]["aequilibrae"]["gates"]
        self.assertEqual(gates[0]["outcome"], "fail")
        self.assertEqual(gates[1]["outcome"], "pass")
        self.assertEqual(result["methods"]["aequilibrae"]["uses"]["screening"], "fail")
        self.assertEqual(result["methods"]["activitysim"]["outcome"], "pass")
        self.assertEqual(result["outcome"], "fail")

    def test_fail_with_another_inconclusive_cell(self):
        p, o, m = fixture()
        m["aequilibrae"]["values"]["place-alpha-0"] = 500
        self.assertEqual(run(p, o[:2], m)["outcome"], "fail")

    def test_use_isolation(self):
        p, o, m = fixture()
        p["gates"][5]["threshold"] = 0
        m["aequilibrae"]["values"]["place-alpha-0"] = 101
        uses = run(p, o, m)["methods"]["aequilibrae"]["uses"]
        self.assertEqual(uses, {"screening": "pass", "replication": "fail"})

    def test_weighted_residuals_all_levels(self):
        p, o, m = fixture()
        m["aequilibrae"]["values"]["place-alpha-0"] = 125
        result = run(p, o, m)["methods"]["aequilibrae"]["gates"]
        link = result[0]["residuals"][0]
        self.assertEqual((link["raw_signed_residual"], link["raw_ape"], link["excess_error"], link["excess_ape"], link["interval_width"]), (25, 25, 15, 15, 20))
        for gate in result[1:5]:
            row = gate["residuals"][0]
            self.assertEqual((row["observed"], row["modeled"], row["lower"], row["upper"], row["excess_error"]), (300, 325, 280, 320, 5))
        p["gates"][2]["groups"][0]["members"]["place-alpha-0"] = 2
        row = run(p, o, m)["methods"]["aequilibrae"]["gates"][2]["residuals"][0]
        self.assertEqual((row["observed"], row["modeled"], row["lower"], row["upper"], row["excess_error"]), (400, 450, 370, 430, 20))

    def test_unloaded_zero_retained(self):
        p, o, m = fixture()
        m["aequilibrae"]["values"]["place-alpha-0"] = 0
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual(gate["outcome"], "fail")
        self.assertEqual(gate["residuals"][0]["raw_ape"], 100)
        self.assertEqual(gate["residuals"][0]["excess_error"], 90)

    def test_zero_observation_cannot_pass(self):
        p, o, m = fixture()
        o[0].update(observed=0, lower=0, upper=0)
        m["aequilibrae"]["values"][o[0]["id"]] = 0
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual(gate["outcome"], "inconclusive")
        self.assertIsNone(gate["value"])

    def test_insufficient_clusters(self):
        p, o, m = fixture()
        p["gates"][0]["minimum_independent_clusters"] = 3
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual(gate["outcome"], "inconclusive")
        self.assertIn("insufficient independent geographic/source clusters", gate["reasons"])

    def test_boundary_operators(self):
        for operator, expected in (("le", "pass"), ("lt", "fail")):
            p, o, m = fixture()
            p["gates"][0]["operator"] = operator
            m["aequilibrae"]["values"]["place-alpha-0"] = 120
            self.assertEqual(run(p, o, m)["methods"]["aequilibrae"]["gates"][0]["outcome"], expected)

    def test_metrics(self):
        for metric, threshold, expected, value in (
            ("max_raw_ape", 30, "fail", 50), ("max_excess_ape", 40, "pass", 40),
            ("raw_percent_rmse", 20, "fail", (2500 / 2) ** 0.5 / 150 * 100),
            ("excess_percent_rmse", 20, "pass", (1600 / 2) ** 0.5 / 150 * 100),
            ("pearson_correlation", 0.88, "pass", 1), ("share_within_tolerance", 75, "fail", 50),
        ):
            p, o, m = fixture()
            p["gates"][0].update(metric=metric, threshold=threshold, operator="ge" if metric in {"pearson_correlation", "share_within_tolerance"} else "le")
            m["aequilibrae"]["values"]["place-alpha-0"] = 150
            gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
            with self.subTest(metric=metric):
                self.assertAlmostEqual(gate["value"], value)
                self.assertEqual(gate["outcome"], expected)

    def test_degenerate_correlation(self):
        p, o, m = fixture()
        p["gates"][0].update(metric="pearson_correlation", threshold=0.88, operator="ge")
        m["aequilibrae"]["values"].update({"place-alpha-0": 200, "place-alpha-1": 200})
        self.assertEqual(run(p, o, m)["methods"]["aequilibrae"]["gates"][0]["outcome"], "inconclusive")


    def test_bad_outputs_are_inconclusive(self):
        for value in (None, float("nan"), float("inf"), -1, True, 10 ** 1000):
            p, o, m = fixture()
            m["aequilibrae"]["values"]["place-alpha-0"] = value
            gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
            self.assertEqual(gate["outcome"], "inconclusive")
            self.assertIn("missing or invalid aequilibrae output", gate["reasons"][0])

    def test_all_basis_dimensions(self):
        for field in ("year", "day", "period", "direction", "lanes", "vehicle", "unit", "quantity"):
            p, o, m = fixture()
            m["aequilibrae"]["basis"]["place-alpha-0"][field] = "different"
            gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
            self.assertEqual(gate["outcome"], "inconclusive")
            self.assertIn("comparison basis differs", gate["reasons"][0])

    def test_aggregate_overflow(self):
        p, o, m = fixture()
        for row in o:
            row.update(observed=1e308, lower=1e308, upper=1e308)
            for method in METHODS:
                m[method]["values"][row["id"]] = 1e308
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][1]
        self.assertEqual(gate["outcome"], "inconclusive")
        self.assertIn("nonfinite aggregate", gate["reasons"][0])

    def test_negative_correlation_fails(self):
        p, o, m = fixture()
        p["gates"][0].update(metric="pearson_correlation", threshold=0.88, operator="ge")
        m["aequilibrae"]["values"].update({"place-alpha-0": 200, "place-alpha-1": 100})
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual((gate["value"], gate["outcome"]), (-1, "fail"))

    def test_share_equality_passes(self):
        p, o, m = fixture()
        p["gates"][0].update(metric="share_within_tolerance", threshold=50, operator="ge")
        m["aequilibrae"]["values"]["place-alpha-0"] = 150
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual((gate["value"], gate["outcome"]), (50, "pass"))

    def test_share_counts_boundary_as_inside(self):
        p, o, m = fixture()
        p["gates"][0].update(metric="share_within_tolerance", threshold=75, operator="ge")
        m["aequilibrae"]["values"]["place-alpha-0"] = 120
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual((gate["value"], gate["outcome"]), (100, "pass"))

    def test_inside_interval_is_not_accuracy(self):
        p, o, m = fixture()
        o[0].update(lower=0, upper=1000)
        m["aequilibrae"]["values"]["place-alpha-0"] = 500
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual(gate["residuals"][0]["excess_error"], 0)
        self.assertEqual(gate["outcome"], "fail")

    def test_no_input_mutation(self):
        p, o, m = fixture()
        before = copy.deepcopy((p, o, m))
        run(p, o, m)
        self.assertEqual((p, o, m), before)


def protocol_case(path, value, reason):
    def test(self):
        p, o, m = fixture()
        set_path(p, path, value)
        with self.assertRaisesRegex(AcceptanceRefused, reason):
            run(p, o, m)
    return test


for name, path, value, reason in PROTOCOL_REFUSALS:
    setattr(AcceptanceTests, "test_protocol_" + name, protocol_case(path, value, reason))

OUTPUT_REFUSALS = [
    ("identity", ("method",), "activitysim", "method identity differs"),
    ("shared", ("shared_context", "network"), "0" * 64, "method inputs differ from shared boundary"),
    ("context", ("method_context",), "0" * 64, "method code/settings differ from freeze"),
    ("extra", ("values", "unexpected"), 100, "unexpected model observation"),
]
for name, path, value, reason in OUTPUT_REFUSALS:
    def test(self, path=path, value=value, reason=reason):
        p, o, m = fixture()
        set_path(m["aequilibrae"], path, value)
        with self.assertRaisesRegex(AcceptanceRefused, reason):
            run(p, o, m)
    setattr(AcceptanceTests, "test_output_" + name, test)

INSUFFICIENT_CASES = [
    ("interval_missing", "lower", None, "interval unavailable"),
    ("interval_reversed", "lower", 101, "interval unavailable"),
    ("interval_nonfinite", "upper", float("inf"), "interval unavailable"),
    ("boolean", "observed", True, "interval unavailable"),
    ("interval_provenance", "interval_evidence_sha256", "", "provenance unproved"),
    ("source_changed", "source_sha256", "0" * 64, "provenance unproved"),
    ("interval_method_changed", "interval_method", "0" * 64, "provenance unproved"),
    ("grade_c", "grade", "C", "nondecisive observation"),
    ("grade_d", "grade", "D", "nondecisive observation"),
    ("qa", "qa_passed", False, "nondecisive observation"),
    ("match", "match_status", "ambiguous", "unresolved match"),
    ("basis", "basis", {}, "comparison basis differs"),
]
for name, field, value, reason in INSUFFICIENT_CASES:
    def test(self, field=field, value=value, reason=reason):
        p, o, m = fixture()
        o[0][field] = value
        gate = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
        self.assertEqual(gate["outcome"], "inconclusive")
        self.assertTrue(any(reason in r for r in gate["reasons"]))
    setattr(AcceptanceTests, "test_insufficient_" + name, test)

# Exercise all scientific decisions for every implemented metric independently.
for metric in ("max_raw_ape", "max_excess_ape", "raw_percent_rmse", "excess_percent_rmse", "pearson_correlation", "share_within_tolerance"):
    for outcome in ("pass", "fail", "inconclusive"):
        def test(self, metric=metric, outcome=outcome):
            p, o, m = fixture()
            g = p["gates"][0]
            g.update(metric=metric, threshold=0.88 if metric == "pearson_correlation" else 75 if metric == "share_within_tolerance" else 20,
                     operator="ge" if metric in {"pearson_correlation", "share_within_tolerance"} else "le")
            if outcome == "fail":
                m["aequilibrae"]["values"]["place-alpha-0"] = 500
            if outcome == "inconclusive":
                o[0].update(observed=0, lower=0, upper=0)
            result = run(p, o, m)["methods"]["aequilibrae"]["gates"][0]
            self.assertEqual(result["outcome"], outcome)
        setattr(AcceptanceTests, "test_metric_" + metric + "_" + outcome, test)

if __name__ == "__main__":
    unittest.main()
