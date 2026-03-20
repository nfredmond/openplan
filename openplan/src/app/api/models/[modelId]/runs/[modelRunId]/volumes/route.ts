import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import Database from "better-sqlite3";

/**
 * GET /api/models/[modelId]/runs/[modelRunId]/volumes
 *
 * Returns a GeoJSON FeatureCollection of road links with assigned traffic volumes.
 * Each feature includes link geometry from the AequilibraE Spatialite DB and
 * volume metrics from link_volumes.csv.
 *
 * Query params:
 *   minVolume (default 0) — filter out links below this PCE threshold
 *   limit (default 5000)  — max features returned
 */

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

// For the pilot, we know the data directory. In production this would come from artifact storage.
const PILOT_DATA_DIR = path.resolve(
  process.cwd(),
  "../data/pilot-nevada-county"
);

export async function GET(
  request: NextRequest,
  { params }: RouteContext
) {
  const { modelId, modelRunId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify run exists and belongs to model
  const { data: run } = await supabase
    .from("model_runs")
    .select("id, status, engine_key")
    .eq("id", modelRunId)
    .eq("model_id", modelId)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ error: "Model run not found" }, { status: 404 });
  }

  if (run.status !== "succeeded") {
    return NextResponse.json(
      { error: "Run has not completed yet", status: run.status },
      { status: 400 }
    );
  }

  // Parse query params
  const minVolume = Number(
    request.nextUrl.searchParams.get("minVolume") ?? "0"
  );
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? "5000"),
    10000
  );

  try {
    // Read link_volumes.csv
    const volumesPath = path.join(PILOT_DATA_DIR, "run_output", "link_volumes.csv");
    if (!existsSync(volumesPath)) {
      return NextResponse.json(
        { error: "Link volumes file not found" },
        { status: 404 }
      );
    }

    const csvContent = await readFile(volumesPath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      cast: true,
    }) as Array<Record<string, number>>;

    // Build volume lookup: link_id -> metrics
    const volumeMap = new Map<
      number,
      { pce_tot: number; pce_ab: number; pce_ba: number; voc_max: number; delay_max: number; congested_time_max: number }
    >();

    for (const row of records) {
      const linkId = row["link_id"] ?? row[""];
      const pceTot = row["PCE_tot"] ?? 0;
      if (pceTot >= minVolume && linkId) {
        volumeMap.set(Number(linkId), {
          pce_tot: pceTot,
          pce_ab: row["PCE_AB"] ?? 0,
          pce_ba: row["PCE_BA"] ?? 0,
          voc_max: row["VOC_max"] ?? 0,
          delay_max: row["Delay_factor_Max"] ?? 0,
          congested_time_max: row["Congested_Time_Max"] ?? 0,
        });
      }
    }

    // Read road geometry from AequilibraE SQLite (without Spatialite for portability)
    const dbPath = path.join(PILOT_DATA_DIR, "aeq_project", "project_database.sqlite");
    if (!existsSync(dbPath)) {
      return NextResponse.json(
        { error: "AequilibraE project database not found" },
        { status: 404 }
      );
    }

    const db = new Database(dbPath);

    // Load spatialite for AsGeoJSON
    try {
      db.loadExtension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite");
    } catch {
      // If spatialite isn't available, we'll extract coordinates manually
    }

    // Query links with geometry
    const linkIds = Array.from(volumeMap.keys());
    if (linkIds.length === 0) {
      return NextResponse.json({
        type: "FeatureCollection",
        features: [],
        metadata: { totalLinks: 0, minVolume, modelRunId },
      });
    }

    // Sort by volume descending and take top `limit`
    const sortedIds = linkIds
      .sort((a, b) => (volumeMap.get(b)?.pce_tot ?? 0) - (volumeMap.get(a)?.pce_tot ?? 0))
      .slice(0, limit);

    const placeholders = sortedIds.map(() => "?").join(",");

    let features: GeoJSON.Feature[];

    try {
      // Try with spatialite (preferred — gives proper GeoJSON geometry)
      const stmt = db.prepare(
        `SELECT link_id, a_node, b_node, link_type, name, AsGeoJSON(geometry) as geojson
         FROM links WHERE link_id IN (${placeholders})`
      );
      const rows = stmt.all(...sortedIds) as Array<{
        link_id: number;
        a_node: number;
        b_node: number;
        link_type: string;
        name: string | null;
        geojson: string | null;
      }>;

      features = rows
        .filter((row) => row.geojson)
        .map((row) => {
          const vol = volumeMap.get(row.link_id)!;
          return {
            type: "Feature" as const,
            properties: {
              link_id: row.link_id,
              name: row.name ?? "",
              link_type: row.link_type,
              pce_tot: Math.round(vol.pce_tot),
              pce_ab: Math.round(vol.pce_ab),
              pce_ba: Math.round(vol.pce_ba),
              voc_max: Math.round(vol.voc_max * 100) / 100,
              delay_factor: Math.round(vol.delay_max * 100) / 100,
            },
            geometry: JSON.parse(row.geojson!),
          };
        });
    } catch {
      // Fallback: return link IDs and volumes without geometry
      features = sortedIds.map((lid) => {
        const vol = volumeMap.get(lid)!;
        return {
          type: "Feature" as const,
          properties: {
            link_id: lid,
            pce_tot: Math.round(vol.pce_tot),
            pce_ab: Math.round(vol.pce_ab),
            pce_ba: Math.round(vol.pce_ba),
            voc_max: Math.round(vol.voc_max * 100) / 100,
            delay_factor: Math.round(vol.delay_max * 100) / 100,
          },
          geometry: { type: "Point" as const, coordinates: [0, 0] },
        };
      });
    }

    db.close();

    // Sort features by volume for consistent rendering (highest on top)
    features.sort(
      (a, b) =>
        ((b.properties as Record<string, number>).pce_tot ?? 0) -
        ((a.properties as Record<string, number>).pce_tot ?? 0)
    );

    const maxVolume = features.length > 0
      ? Math.max(...features.map((f) => (f.properties as Record<string, number>).pce_tot ?? 0))
      : 0;

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      metadata: {
        totalLinks: features.length,
        maxVolume,
        minVolume,
        modelRunId,
        engine: "AequilibraE 1.6.1",
        caveats: ["Uncalibrated", "OSM default speeds/capacities", "Screening-grade"],
      },
    });
  } catch (error) {
    console.error("Volumes endpoint error:", error);
    return NextResponse.json(
      { error: "Failed to generate volume GeoJSON" },
      { status: 500 }
    );
  }
}
