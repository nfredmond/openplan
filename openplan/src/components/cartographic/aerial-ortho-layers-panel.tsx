"use client";

import Link from "next/link";

import { useAerialOrthoLayers } from "./aerial-ortho-layer-context";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value: string | null): string | null {
  const date = value?.slice(0, 10);
  return date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function shortHash(checksum: string): string {
  return `${checksum.slice(0, 12)}...`;
}

export function AerialOrthoLayersPanel({ compact = false }: { compact?: boolean }) {
  const { catalogState, layers, notes, selected, failures, toggleSelected } = useAerialOrthoLayers();
  const onCount = layers.filter((layer) => selected[layer.custodyId] === true).length;

  return (
    <section aria-label="Aerial imagery layers" data-testid="aerial-ortho-layers-panel">
      <div className={compact ? "mb-2 flex items-center justify-between gap-2" : "op-cart-layers__hd op-cart-layers__hd--sub"}>
        <span>Aerial imagery</span>
        {compact ? (
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            {layers.length === 0 ? "None ready" : `${onCount} of ${layers.length} on`}
          </span>
        ) : null}
      </div>

      {catalogState === "unreadable" ? (
        <p className={compact ? "text-xs text-destructive" : "op-cart-layer-item__note"} role="alert">
          {notes[0]}
        </p>
      ) : layers.length === 0 ? (
        <p className={compact ? "text-xs text-muted-foreground" : "op-cart-layer-item__note"}>
          {catalogState === "unavailable"
            ? "Processed previews exist, but none has verified custody and map placement."
            : "No map-ready aerial preview yet. Process a mission in Aerial first."}{" "}
          <Link href="/aerial" className="underline underline-offset-2">Open Aerial</Link>
        </p>
      ) : (
        <ul className={compact ? "flex flex-col gap-2" : "op-cart-layers__list"} role="list">
          {layers.map((layer) => (
            <li key={layer.custodyId}>
              <label className={compact ? "flex items-start gap-2 text-sm" : "op-cart-layer-item"}>
                <input
                  type="checkbox"
                  checked={selected[layer.custodyId] === true}
                  onChange={() => toggleSelected(layer.custodyId)}
                />
                <span className="min-w-0 flex-1">
                  <span className={compact ? "block truncate" : "op-cart-layer-item__label"}>
                    {layer.missionTitle}
                  </span>
                  <span className={compact ? "block text-xs text-muted-foreground" : "op-cart-layer-item__note"}>
                    {layer.projectName ? `${layer.projectName} · ` : ""}{formatBytes(layer.byteSize)} preview
                  </span>
                  {failures[layer.custodyId] ? (
                    <span className="block text-xs text-destructive" role="alert">
                      Could not load this preview: {failures[layer.custodyId]}
                    </span>
                  ) : null}
                  <details className="mt-1 text-xs text-muted-foreground">
                    <summary className="cursor-pointer">Custody and placement</summary>
                    <span className="block">SHA-256 {shortHash(layer.checksumSha256)}</span>
                    {formatDate(layer.collectedAt) ? (
                      <span className="block">Collected {formatDate(layer.collectedAt)}</span>
                    ) : null}
                    {formatDate(layer.heldAt) ? (
                      <span className="block">Held {formatDate(layer.heldAt)}</span>
                    ) : null}
                    {layer.pixelSizeM !== null ? (
                      <span className="block">Ground sample distance {layer.pixelSizeM} m</span>
                    ) : null}
                    {layer.nativeCrs ? <span className="block">Native CRS {layer.nativeCrs}</span> : null}
                  </details>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && catalogState !== "unreadable" ? (
        <details className={compact ? "mt-3" : "op-cart-layers__ft"}>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            {notes.length === 1 ? "1 imagery note" : `${notes.length} imagery notes`}
          </summary>
          {notes.map((note) => (
            <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>
          ))}
        </details>
      ) : null}
    </section>
  );
}
