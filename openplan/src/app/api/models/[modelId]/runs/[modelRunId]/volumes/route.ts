import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import Database from "better-sqlite3";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { loadModelAccess } from "@/lib/models/api";

/**
 * GET /api/models/[modelId]/runs/[modelRunId]/volumes
 *
 * Returns a GeoJSON FeatureCollection of road links with assigned traffic volumes.
 * Prefers the worker-authored `volumes_geojson` artifact for the specific run and
 * falls back to reconstructing GeoJSON from run-local files when needed.
 *
 * Query params:
 *   minVolume (default 0) — filter out links below this PCE threshold
 *   limit (default 5000)  — max features returned
 */

const paramsSchema = z.object({
  modelId: z.string().uuid(),
  modelRunId: z.string().uuid(),
});

type RouteContext = {
  params: Promise<{ modelId: string; modelRunId: string }>;
};

type ArtifactRow = {
  artifact_type: string;
  file_url: string | null;
};

type VolumeRow = Record<string, number>;

type GeoJsonFeatureCollection = {
  type: "FeatureCollection";
  features: GeoJSON.Feature[];
  metadata?: Record<string, unknown>;
};

const DEFAULT_WORKER_ROOT = path.resolve(
  process.cwd(),
  "../data/pilot-nevada-county"
);

async function loadJsonArtifact(fileUrl: string): Promise<unknown> {
  if (fileUrl.startsWith("local://")) {
    const payload = await readFile(fileUrl.slice("local://".length), "utf8");
    return JSON.parse(payload);
  }

  if (fileUrl.startsWith("http://") || fileUrl.startsWith("https://")) {
    const res = await fetch(fileUrl, { cache: "no-store" });
    if (!res.ok) {
      throw new Error(`Artifact fetch failed (${res.status})`);
    }
    return res.json();
  }

  const payload = await readFile(fileUrl, "utf8");
  return JSON.parse(payload);
}

function resolveRunWorkDir(modelRunId: string) {
  return path.join(DEFAULT_WORKER_ROOT, "runs", modelRunId.slice(0, 12));
}

export async function GET(request: NextRequest, context: RouteContext) {
  const routeParams = await context.params;
  const parsedParams = paramsSchema.safeParse(routeParams);

  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid model run route params" }, { status: 400 });
  }

  const { modelId, modelRunId } = parsedParams.data;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const access = await loadModelAccess(supabase, modelId, user.id, "models.read");
  if (access.error) {
    return NextResponse.json({ error: "Failed to load model" }, { status: 500 });
  }
  if (!access.model) {
    return NextResponse.json({ error: "Model not found" }, { status: 404 });
  }
  if (!access.membership || !access.allowed) {
    return NextResponse.json({ error: "Workspace access denied" }, { status: 403 });
  }

  const { data: run, error: runError } = await supabase
    .from("model_runs")
    .select("id, status, engine_key")
    .eq("id", modelRunId)
    .eq("model_id", access.model.id)
    .maybeSingle();

  if (runError || !run) {
    return NextResponse.json({ error: "Model run not found" }, { status: 404 });
  }

  if (run.status !== "succeeded") {
    return NextResponse.json(
      { error: "Run has not completed yet", status: run.status },
      { status: 400 }
    );
  }

  const minVolume = Number(request.nextUrl.searchParams.get("minVolume") ?? "0");
  const limit = Math.min(
    Number(request.nextUrl.searchParams.get("limit") ?? "5000"),
    10000
  );

  try {
    const { data: artifacts, error: artifactError } = await supabase
      .from("model_run_artifacts")
      .select("artifact_type, file_url")
      .eq("run_id", modelRunId)
      .order("created_at", { ascending: true });

    if (artifactError) {
      return NextResponse.json(
        { error: "Failed to load model run artifacts" },
        { status: 500 }
      );
    }

    const artifactRows = (artifacts ?? []) as ArtifactRow[];
    const volumesGeojsonArtifact = artifactRows.find(
      (artifact) =>
        artifact.artifact_type === "volumes_geojson" &&
        typeof artifact.file_url === "string" &&
        Boolean(artifact.file_url)
    );

    if (volumesGeojsonArtifact?.file_url) {
      const geojson = (await loadJsonArtifact(
        volumesGeojsonArtifact.file_url
      )) as GeoJsonFeatureCollection;
      const features = (geojson.features ?? []).filter((feature) => {
        const value = Number(
          (feature.properties as Record<string, unknown> | undefined)?.pce_tot ?? 0
        );
        return value >= minVolume;
      });

      features.sort(
        (a, b) =>
          Number((b.properties as Record<string, unknown> | undefined)?.pce_tot ?? 0) -
          Number((a.properties as Record<string, unknown> | undefined)?.pce_tot ?? 0)
      );

      const limitedFeatures = features.slice(0, limit);
      const maxVolume =
        limitedFeatures.length > 0
          ? Math.max(
              ...limitedFeatures.map((feature) =>
                Number(
                  (feature.properties as Record<string, unknown> | undefined)?.pce_tot ?? 0
                )
              )
            )
          : 0;

      return NextResponse.json({
        type: "FeatureCollection",
        features: limitedFeatures,
        metadata: {
          ...(geojson.metadata ?? {}),
          totalLinks: limitedFeatures.length,
          maxVolume,
          minVolume,
          modelRunId,
          source: "artifact",
          engine: run.engine_key ?? "AequilibraE 1.6.1",
        },
      });
    }

    const runWorkDir = resolveRunWorkDir(modelRunId);
    const volumesPath = path.join(runWorkDir, "run_output", "link_volumes.csv");
    const dbPath = path.join(runWorkDir, "aeq_project", "project_database.sqlite");

    if (!existsSync(volumesPath)) {
      return NextResponse.json(
        { error: "Run-specific link volumes file not found" },
        { status: 404 }
      );
    }

    if (!existsSync(dbPath)) {
      return NextResponse.json(
        { error: "Run-specific AequilibraE project database not found" },
        { status: 404 }
      );
    }

    const csvContent = await readFile(volumesPath, "utf-8");
    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      cast: true,
    }) as VolumeRow[];

    const volumeMap = new Map<
      number,
      {
        pce_tot: number;
        pce_ab: number;
        pce_ba: number;
        voc_max: number;
        delay_max: number;
        congested_time_max: number;
      }
    >();

    for (const row of records) {
      const linkId = row.link_id ?? row[""];
      const pceTot = row.PCE_tot ?? 0;
      if (pceTot >= minVolume && linkId) {
        volumeMap.set(Number(linkId), {
          pce_tot: pceTot,
          pce_ab: row.PCE_AB ?? 0,
          pce_ba: row.PCE_BA ?? 0,
          voc_max: row.VOC_max ?? 0,
          delay_max: row.Delay_factor_Max ?? 0,
          congested_time_max: row.Congested_Time_Max ?? 0,
        });
      }
    }

    const linkIds = Array.from(volumeMap.keys())
      .sort(
        (a, b) =>
          (volumeMap.get(b)?.pce_tot ?? 0) - (volumeMap.get(a)?.pce_tot ?? 0)
      )
      .slice(0, limit);

    if (linkIds.length === 0) {
      return NextResponse.json({
        type: "FeatureCollection",
        features: [],
        metadata: {
          totalLinks: 0,
          minVolume,
          modelRunId,
          source: "fallback-empty",
        },
      });
    }

    const db = new Database(dbPath);

    try {
      db.loadExtension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite");
    } catch {
      // Keep portability; query falls back without extension if unavailable.
    }

    const placeholders = linkIds.map(() => "?").join(",");
    let features: GeoJSON.Feature[] = [];

    try {
      const stmt = db.prepare(
        `SELECT link_id, a_node, b_node, link_type, name, AsGeoJSON(geometry) as geojson
         FROM links WHERE link_id IN (${placeholders})`
      );
      const rows = stmt.all(...linkIds) as Array<{
        link_id: number;
        a_node: number;
        b_node: number;
        link_type: string;
        name: string | null;
        geojson: string | null;
      }>;

      features = rows.flatMap((row) => {
        if (!row.geojson) {
          return [];
        }

        const vol = volumeMap.get(row.link_id)!;
        return [
          {
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
            geometry: JSON.parse(row.geojson),
          },
        ];
      });
    } catch {
      features = linkIds.map((linkId) => {
        const vol = volumeMap.get(linkId)!;
        return {
          type: "Feature" as const,
          properties: {
            link_id: linkId,
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

    const maxVolume =
      features.length > 0
        ? Math.max(
            ...features.map((feature) =>
              Number(
                (feature.properties as Record<string, unknown> | undefined)?.pce_tot ?? 0
              )
            )
          )
        : 0;

    return NextResponse.json({
      type: "FeatureCollection",
      features,
      metadata: {
        totalLinks: features.length,
        maxVolume,
        minVolume,
        modelRunId,
        source: "run-local-fallback",
        engine: run.engine_key ?? "AequilibraE 1.6.1",
        caveats: [
          "Uncalibrated",
          "OSM default speeds/capacities",
          "Screening-grade",
          "Reconstructed from run-local files because no volumes_geojson artifact was registered.",
        ],
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
