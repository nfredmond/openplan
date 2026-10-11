"""Compare the identified browser read with fresh isolated native records."""
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path


HERE = Path(__file__).resolve().parent
HEAD = "c75fa343d6b0c9fed028bda042f73a7fc2a1a637"
BUILD = "palf6jxoWtH9FdWik_Q6r"
VERSION = "1ca4fa87-713d-4a0e-8015-9edd428f1640"
FEED = "16e2e138-400a-49ff-8bc3-089ff185e5d7"
PROJECT = "a5b3eaad-7aa4-4693-b56a-3c77cc606abc"
MODEL = "492638e4-9937-4e61-a31c-d69f7e36f49b"


def read_native(proof):
    settings = json.loads((proof / "browser-full-restore-02/fresh-services-private.json").read_text())
    assert settings["database"] == "openplan_recovered_2553c3e83129432e86c97cf3aef72aee", "isolated-database-scope"

    def sql(database, query):
        output = subprocess.check_output([
            "docker", "exec", "supabase_db_openplan-restore-target-2026091050",
            "psql", "-U", "supabase_admin", "-d", database, "-XAt", "-c", query,
        ], text=True)
        return json.loads(output)

    query = f"SELECT row_to_json(t) FROM (SELECT id,workspace_id,place_label,place_geometry_geojson FROM projects WHERE id='{PROJECT}') t"
    project = sql(settings["database"], query)
    source = sql(settings["sourceDatabase"], query)
    geometry = json.dumps(project["place_geometry_geojson"], separators=(",", ":"), ensure_ascii=False)
    model = sql(settings["database"], f"SELECT row_to_json(t) FROM (SELECT id,workspace_id,project_id,status,(SELECT count(*) FROM model_runs WHERE model_id=m.id) AS runs FROM models m WHERE id='{MODEL}') t")
    cancellation = sql(settings["database"], f"""SELECT json_build_object(
      'state',e.state,'attempt',e.attempt,'tokenAbsent',e.token IS NULL,
      'status',v.status,'failureCode',v.failure_code,'isCurrent',v.is_current,
      'currentVersion',f.current_version_id,
      'claims',(SELECT count(*) FROM openplan_gtfs.claims WHERE version_id=v.id),
      'routeRows',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id),
      'stopRows',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id))
      FROM openplan_gtfs.executions e JOIN public.gtfs_feed_versions v ON v.id=e.version_id
      JOIN public.gtfs_feeds f ON f.id=v.feed_id WHERE v.id='{VERSION}'""")
    current = sql(settings["database"], f"SELECT to_json(current_version_id) FROM public.gtfs_feeds WHERE id='{FEED}'")
    return {
        "project": {k: v for k, v in project.items() if k != "place_geometry_geojson"},
        "sourceProjectUnchanged": project == source,
        "geometrySha256": hashlib.sha256(geometry.encode()).hexdigest(),
        "model": model, "cancelled": cancellation, "currentFeedVersion": current,
    }


def verify(browser, native, artifacts):
    assert browser["head"] == artifacts["head"] == HEAD and browser["buildId"] == artifacts["buildId"] == BUILD, "build-identity"
    assert native["sourceProjectUnchanged"], "source-project-changed"
    model = native["model"]
    project = native["project"]
    assert model["project_id"] == project["id"] == browser["projectId"] == PROJECT and model["workspace_id"] == project["workspace_id"], "model-project-binding"
    assert model["id"] == browser["modelId"] == MODEL and model["status"] == "draft" and model["runs"] == 0, "unexpected-model-execution"
    coverage = browser["desktop"]["coverage"]
    assert coverage["geometrySha256"] == native["geometrySha256"], "browser-geometry-mismatch"
    assert coverage["feedId"] == FEED and coverage["workspaceId"] == project["workspace_id"], "coverage-target-mismatch"
    assert coverage["method"] == "POST" and coverage["status"] == 200 and coverage["response"]["coverage"] == "yes" and coverage["response"]["stopServiceRowsInStudyArea"] == 238, "coverage-response-not-established"
    assert native["currentFeedVersion"] == "8a86a802-a3cc-4b09-979d-6187bad01285", "current-feed-changed"
    cancelled = native["cancelled"]
    assert cancelled["state"] == "cancelled" and cancelled["status"] == "failed" and cancelled["failureCode"] == "abandoned" and cancelled["tokenAbsent"], "cancelled-terminal-not-established"
    assert cancelled["attempt"] == cancelled["claims"] == 1 and cancelled["routeRows"] == cancelled["stopRows"] == 0 and cancelled["currentVersion"] is None and not cancelled["isCurrent"], "cancelled-results-changed"
    for name, width in [("desktop", 1280), ("mobile", 390)]:
        model_view = browser[name]
        history = browser["cancelled"][name]
        assert model_view["width"] == model_view["documentWidth"] == history["width"] == history["documentWidth"] == width, "layout-overflow"
        assert model_view["selectedFeed"] == FEED and model_view["savedOaklandSourceVisible"] and model_view["zeroRunsVisible"] and model_view["scientificCaveatVisible"], "visible-model-custody"
        assert history["panelCount"] == 1 and "Cancelled" in history["cardText"] and VERSION in history["cardText"] and "Worker attempts: 1" in history["cardText"], "visible-cancellation-identity"
        assert not model_view["errors"] and not history["errors"] and not browser["observer"]["errors"], "captured-console-error"
    assert len(artifacts["images"]) == 6, "capture-inventory"
    for record in artifacts["images"]:
        content = (HERE / record["path"]).read_bytes()
        assert len(content) == record["bytes"] and hashlib.sha256(content).hexdigest() == record["sha256"], "capture-bytes-changed"
    return True


def main():
    proof = Path(sys.argv[1]).resolve()
    browser = json.loads((HERE / "reviewed-production-browser.json").read_text())
    artifacts = json.loads((HERE / "reviewed-browser-artifacts.json").read_text())
    native = read_native(proof)
    records = []
    for label in ["baseline", "harmless-note", "restored"]:
        trial = copy.deepcopy(browser)
        if label == "harmless-note":
            trial["reviewerNote"] = "An unrelated note does not change the observations."
        assert verify(trial, native, artifacts)
        records.append({"case": label, "passed": True})
    variants = [
        ("different-build", lambda b,n,a: b.update(buildId="different"), "build-identity"),
        ("changed-project", lambda b,n,a: n.update(sourceProjectUnchanged=False), "source-project-changed"),
        ("wrong-project", lambda b,n,a: n["model"].update(project_id="different"), "model-project-binding"),
        ("unexpected-run", lambda b,n,a: n["model"].update(runs=1), "unexpected-model-execution"),
        ("different-geometry", lambda b,n,a: b["desktop"]["coverage"].update(geometrySha256="0"*64), "browser-geometry-mismatch"),
        ("wrong-feed", lambda b,n,a: b["desktop"]["coverage"].update(feedId="different"), "coverage-target-mismatch"),
        ("failed-coverage", lambda b,n,a: b["desktop"]["coverage"].update(status=503), "coverage-response-not-established"),
        ("replaced-current-version", lambda b,n,a: n.update(currentFeedVersion=VERSION), "current-feed-changed"),
        ("nonterminal-cancellation", lambda b,n,a: n["cancelled"].update(state="running"), "cancelled-terminal-not-established"),
        ("published-cancelled-results", lambda b,n,a: n["cancelled"].update(stopRows=1), "cancelled-results-changed"),
        ("mobile-overflow", lambda b,n,a: b["mobile"].update(documentWidth=450), "layout-overflow"),
        ("lost-source-disclosure", lambda b,n,a: b["mobile"].update(savedOaklandSourceVisible=False), "visible-model-custody"),
        ("duplicate-history-panel", lambda b,n,a: b["cancelled"]["mobile"].update(panelCount=2), "visible-cancellation-identity"),
        ("console-error", lambda b,n,a: b["observer"].update(errors=["synthetic error"]), "captured-console-error"),
        ("missing-capture", lambda b,n,a: a["images"].pop(), "capture-inventory"),
        ("changed-capture-hash", lambda b,n,a: a["images"][0].update(sha256="0"*64), "capture-bytes-changed"),
    ]
    for label, mutate, expected in variants:
        trial = [copy.deepcopy(x) for x in [browser, native, artifacts]]
        try:
            mutate(*trial)
            verify(*trial)
        except AssertionError as error:
            assert str(error) == expected, (label, str(error))
            records.append({"case": label, "passed": True, "expectedFailure": expected})
        else:
            raise AssertionError("Broken observation survived: " + label)
        finally:
            assert verify(browser, native, artifacts)
    (HERE / "reviewed-browser-native.json").write_text(json.dumps(native, indent=2) + "\n")
    (HERE / "reviewed-browser-controls.json").write_text(json.dumps({"records": records, "nativeReadRepeated": True, "limits": ["Controls alter isolated copies of browser, native and artifact observations. No database, app or capture edits.", "Recorded c75 build read and future-only console interval. No post-crash browser acceptance, scientific validity or physical phone claim."]}, indent=2) + "\n")
    print("Three positive and 16 targeted broken observation controls pass; native records reread.")


if __name__ == "__main__":
    main()
