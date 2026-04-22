"use client";

import { LAYER_KEYS, useCartographicLayers, type LayerKey } from "./cartographic-context";

// TODO(live-counts): chip values are NCTC-demo placeholders. Wire these to
// live workspace counts (projects, rtp cycles, aerial missions, etc.) once
// the inspector dock gains its own data fetcher.
const LAYER_META: Record<LayerKey, { label: string; chip?: string | number }> = {
  projects: { label: "Projects", chip: 14 },
  rtp: { label: "RTP corridors", chip: 2 },
  corridors: { label: "Study corridors", chip: 6 },
  engagement: { label: "Engagement pins", chip: "3.8k" },
  aerial: { label: "Aerial missions", chip: 1 },
  transit: { label: "GTFS transit" },
  crashes: { label: "Crash density" },
  equity: { label: "Equity priority" },
};

export function CartographicLayersPanel() {
  const { layers, toggleLayer } = useCartographicLayers();

  return (
    <aside className="op-cart-layers" aria-label="Map layers">
      <div className="op-cart-layers__hd">Layers</div>
      <ul className="op-cart-layers__list" role="list">
        {LAYER_KEYS.map((key) => {
          const meta = LAYER_META[key];
          const chipVisible = meta.chip !== undefined && meta.chip !== "";
          return (
            <li key={key}>
              <label className="op-cart-layer-item">
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => toggleLayer(key)}
                />
                <span className="op-cart-layer-item__label">{meta.label}</span>
                {chipVisible ? (
                  <span className="op-cart-layer-item__chip">{meta.chip}</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
      <div className="op-cart-layers__ft">
        Basemap: <strong>Civic parchment</strong>
      </div>
    </aside>
  );
}
