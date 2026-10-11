"""Read only the expanded target used by the frozen f72 T3 preview."""
import hashlib,json,subprocess
from pathlib import Path
OUT=Path(__file__).parent
CONTAINER="a4181e334bb0da63e213aaea5966d163e24faab58ddb3e6122665b3c41042cce"
PROJECT="a5b3eaad-7aa4-4693-b56a-3c77cc606abc"
MODEL="492638e4-9937-4e61-a31c-d69f7e36f49b"
VERSION="1ca4fa87-713d-4a0e-8015-9edd428f1640"
FEED="16e2e138-400a-49ff-8bc3-089ff185e5d7"
SETTINGS={"database":"openplan_attempt_cli_fc468084c83c4a2499c60ab61d48db47","sourceDatabase":"openplan_attempt_cli_9aa151eb08634def815ac5db9815f638"}
def verify_native_scope(settings, container):
    assert settings["database"] == "openplan_attempt_cli_fc468084c83c4a2499c60ab61d48db47", "isolated-database-scope"
    assert settings["sourceDatabase"] == "openplan_attempt_cli_9aa151eb08634def815ac5db9815f638", "isolated-source-scope"
    assert container["Id"] == CONTAINER, "isolated-container-identity"
    assert container["Name"] == "/supabase_db_openplan-restore-target-2026091050", "isolated-container-name"
    assert container["Config"]["Labels"].get("com.supabase.cli.project") == "openplan-restore-target-2026091050", "isolated-container-project"
    assert container["State"]["Running"], "isolated-container-running"

def read_native():
    settings=SETTINGS
    container=json.loads(subprocess.check_output(["docker","inspect",CONTAINER]))[0]
    verify_native_scope(settings,container)
    def sql(database, query):
        output = subprocess.check_output([
            "docker", "exec", CONTAINER,
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
    version = sql(settings["database"], f"SELECT row_to_json(t) FROM (SELECT id,feed_id,route_count,stop_count,service_end_date FROM public.gtfs_feed_versions WHERE id='{current}') t")
    def positions(coords):
        if isinstance(coords[0], (float, int)):
            yield coords
        else:
            for child in coords:
                yield from positions(child)
    points = list(positions(project["place_geometry_geojson"]["coordinates"]))
    min_lon, max_lon = min(x[0] for x in points), max(x[0] for x in points)
    min_lat, max_lat = min(x[1] for x in points), max(x[1] for x in points)
    rows = sql(settings["database"], f"SELECT to_json(count(*)) FROM public.gtfs_stop_service_levels WHERE feed_version_id='{current}' AND longitude BETWEEN {min_lon} AND {max_lon} AND latitude BETWEEN {min_lat} AND {max_lat}")
    cta = sql(settings["database"], """SELECT json_build_object(
      'versionId',v.id,'feedId',f.id,'workspaceId',v.workspace_id,
      'state',e.state,'status',v.status,'isCurrent',v.is_current,
      'currentVersion',f.current_version_id,'tokenAbsent',e.token IS NULL,
      'routeCount',v.route_count,'stopCount',v.stop_count,
      'claims',(SELECT count(*) FROM openplan_gtfs.claims WHERE version_id=v.id),
      'routeRows',(SELECT count(*) FROM public.gtfs_route_service_levels WHERE feed_version_id=v.id),
      'stopRows',(SELECT count(*) FROM public.gtfs_stop_service_levels WHERE feed_version_id=v.id))
      FROM public.gtfs_feed_versions v JOIN public.gtfs_feeds f ON f.id=v.feed_id
      JOIN openplan_gtfs.executions e ON e.version_id=v.id
      WHERE v.id='b87fe3ef-00df-4e53-9a19-5e1e3e291470'""")
    return {
        "cta": cta, "currentVersionMetadata": version, "envelopeStopServiceRows": rows,
        "project": {k: v for k, v in project.items() if k != "place_geometry_geojson"},
        "sourceProjectUnchanged": project == source,
        "geometrySha256": hashlib.sha256(geometry.encode()).hexdigest(),
        "model": model, "cancelled": cancellation, "currentFeedVersion": current,
    }


if __name__=="__main__":
    (OUT/"native-browser-records.json").write_text(json.dumps(read_native(),indent=2)+"\n")
