"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, MapPin, Trash2, Upload } from "lucide-react";

import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { formatFileSize } from "@/lib/models/evidence-packet";
import type { AerialImageryRow } from "@/lib/aerial/imagery";

/**
 * The mission's source photos: upload, list, download, delete.
 *
 * SELF-FETCHING ON PURPOSE. This panel loads its rows from
 * `GET /api/aerial/missions/[missionId]/imagery` rather than taking them as
 * props, so the mission page mounts it with nothing but the mission id and a
 * write flag — the seam the mission map uses too (it fetches the same route
 * for its photo dots), which keeps one source of truth for what is stored.
 *
 * THREE HONESTY RULES THIS COMPONENT HOLDS.
 *  1. A failed load is a failure, never an empty photo list — the error state
 *     and the "no photos yet" state are different sentences.
 *  2. EXIF is evidence. A photo whose file recorded no GPS says "no location
 *     recorded in this photo"; one whose file named no capture instant (a
 *     wall-clock time with no timezone is not an instant) says so. Nothing is
 *     estimated to fill a gap.
 *  3. The coverage line counts photos WITH a recorded location out of the
 *     total, so a mission whose photos carry no GPS reads as exactly that
 *     rather than as a mission with no photos.
 */

type UploadOutcome = {
  filename: string;
  ok: boolean;
  deduped?: boolean;
  message?: string;
};

export function AerialImageryPanel({
  missionId,
  canWrite,
}: {
  missionId: string;
  canWrite: boolean;
}) {
  const [rows, setRows] = useState<AerialImageryRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<UploadOutcome[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await fetch(`/api/aerial/missions/${missionId}/imagery`);
      const body = (await response.json().catch(() => null)) as
        | { imagery?: AerialImageryRow[]; error?: string }
        | null;
      if (!response.ok || !body || !Array.isArray(body.imagery)) {
        // A failed read is reported as itself, never rendered as "no photos".
        setRows(null);
        setLoadError(body?.error ?? "The photo list could not be loaded.");
        return;
      }
      setRows(body.imagery);
    } catch {
      setRows(null);
      setLoadError("Could not reach OpenPlan; the photo list was not loaded.");
    } finally {
      setLoading(false);
    }
  }, [missionId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function uploadFiles(files: FileList) {
    setUploading(true);
    setOutcomes([]);
    const results: UploadOutcome[] = [];
    const list = Array.from(files);
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      setUploadProgress(`Uploading ${index + 1} of ${list.length}: ${file.name}`);
      try {
        const response = await fetch(
          `/api/aerial/missions/${missionId}/imagery?filename=${encodeURIComponent(file.name)}`,
          { method: "POST", body: file }
        );
        const body = (await response.json().catch(() => null)) as
          | { deduped?: boolean; error?: string }
          | null;
        if (!response.ok) {
          // The route's own sentence, verbatim — it knows the ceiling, the
          // format refusal, and the role gate better than this component.
          results.push({ filename: file.name, ok: false, message: body?.error ?? "Upload failed." });
        } else {
          results.push({ filename: file.name, ok: true, deduped: body?.deduped === true });
        }
      } catch {
        results.push({
          filename: file.name,
          ok: false,
          message: "Could not reach OpenPlan. Nothing was stored for this file.",
        });
      }
    }
    setOutcomes(results);
    setUploadProgress(null);
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await load();
  }

  async function deletePhoto(row: AerialImageryRow) {
    if (
      !window.confirm(
        `Delete ${row.original_filename}? The stored photo is removed from this mission; this cannot be undone.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    try {
      const response = await fetch(`/api/aerial/missions/${missionId}/imagery/${row.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { detail?: string; error?: string }
          | null;
        setDeleteError(body?.detail ?? body?.error ?? "The photo could not be deleted.");
        return;
      }
      await load();
    } catch {
      setDeleteError("Could not reach OpenPlan. Nothing was deleted.");
    }
  }

  const total = rows?.length ?? 0;
  const totalBytes = rows?.reduce((sum, row) => sum + (row.byte_size ?? 0), 0) ?? 0;
  const withLocation = rows?.filter((row) => row.gps_lat !== null && row.gps_lon !== null).length ?? 0;

  return (
    <section aria-label="Mission photos" className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Camera className="h-4 w-4" aria-hidden />
            Mission photos
          </h3>
          {rows !== null ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {total === 0
                ? "No photos are stored for this mission yet."
                : `${total} photo${total === 1 ? "" : "s"} · ${formatFileSize(totalBytes) ?? `${totalBytes} bytes`} · ` +
                  `${withLocation} of ${total} carry a location recorded by the camera` +
                  (withLocation < total
                    ? ` — the other ${total - withLocation} recorded none, so they cannot appear on the map`
                    : "")}
            </p>
          ) : null}
        </div>
        {canWrite ? (
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/tiff,.jpg,.jpeg,.png,.tif,.tiff,.dng"
              className="hidden"
              id={`aerial-imagery-upload-${missionId}`}
              onChange={(event) => {
                if (event.target.files && event.target.files.length > 0) {
                  void uploadFiles(event.target.files);
                }
              }}
              disabled={uploading}
            />
            <label
              htmlFor={`aerial-imagery-upload-${missionId}`}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium ${
                uploading ? "opacity-50" : "hover:bg-muted"
              }`}
            >
              <Upload className="h-3.5 w-3.5" aria-hidden />
              {uploading ? "Uploading…" : "Upload photos"}
            </label>
          </div>
        ) : null}
      </div>

      {uploadProgress ? <p className="mt-2 text-xs text-muted-foreground">{uploadProgress}</p> : null}

      {outcomes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs">
          {outcomes.map((outcome) => (
            <li
              key={outcome.filename}
              className={outcome.ok ? "text-muted-foreground" : "text-destructive"}
            >
              {outcome.ok
                ? outcome.deduped
                  ? `${outcome.filename}: already stored for this mission — the existing copy was kept.`
                  : `${outcome.filename}: stored.`
                : `${outcome.filename}: ${outcome.message}`}
            </li>
          ))}
        </ul>
      ) : null}

      {deleteError ? (
        <div className="mt-2">
          <StateBlock tone="danger" compact title="Photo not deleted" description={deleteError} />
        </div>
      ) : null}

      <div className="mt-3">
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading photos…</p>
        ) : loadError ? (
          // A failed read is NOT an empty list.
          <StateBlock
            tone="danger"
            compact
            title="The photo list could not be loaded"
            description={loadError}
          />
        ) : rows && rows.length === 0 ? (
          <EmptyState
            compact
            title="No photos yet"
            description={
              canWrite
                ? "Upload the mission's source photos to hold them in OpenPlan and build processing requests from them."
                : "Nobody has uploaded source photos for this mission."
            }
          />
        ) : rows ? (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <a
                    href={`/api/aerial/missions/${missionId}/imagery/${row.id}/download`}
                    className="break-all text-xs font-medium underline-offset-2 hover:underline"
                  >
                    {row.original_filename}
                  </a>
                  <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                    {formatFileSize(row.byte_size) ?? `${row.byte_size} bytes`}
                    {" · "}
                    {row.gps_lat !== null && row.gps_lon !== null ? (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPin className="inline h-3 w-3" aria-hidden />
                        {row.gps_lat.toFixed(5)}, {row.gps_lon.toFixed(5)}
                      </span>
                    ) : (
                      "no location recorded in this photo"
                    )}
                    {" · "}
                    {row.captured_at
                      ? new Date(row.captured_at).toLocaleString()
                      : "no capture time with a named timezone recorded"}
                    {row.camera_make || row.camera_model
                      ? ` · ${[row.camera_make, row.camera_model].filter(Boolean).join(" ")}`
                      : ""}
                  </p>
                </div>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => void deletePhoto(row)}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[0.68rem] text-destructive hover:bg-destructive/10"
                    aria-label={`Delete ${row.original_filename}`}
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                    Delete
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
