"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

type MapItem = {
  id: string;
  latitude: number | null;
  longitude: number | null;
  title: string | null;
  body: string;
};

export function LocationDisplayMap({ items }: { items: MapItem[] }) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current || !MAPBOX_ACCESS_TOKEN) return;

    mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

    const validItems = items.filter((i) => i.latitude !== null && i.longitude !== null) as (MapItem & { latitude: number; longitude: number })[];

    let center: [number, number] = [-121.033982, 39.239137];
    let zoom = 9.5;
    if (validItems.length > 0) {
      center = [validItems[0].longitude, validItems[0].latitude];
      zoom = 11;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center,
      zoom,
      attributionControl: false,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      validItems.forEach((item) => {
        const popup = new mapboxgl.Popup({ offset: 25, maxWidth: "300px" })
          .setHTML(`
            <div style="padding: 4px; color: black;">
              ${item.title ? `<strong>${item.title}</strong><br/>` : ""}
              <p style="margin: 4px 0 0; font-size: 13px;">${item.body}</p>
            </div>
          `);

        const el = document.createElement('div');
        el.className = 'w-4 h-4 bg-primary rounded-full border-2 border-background shadow-sm cursor-pointer';

        const marker = new mapboxgl.Marker({ element: el })
          .setLngLat([item.longitude, item.latitude])
          .setPopup(popup)
          .addTo(map);
          
        markersRef.current.push(marker);
      });

      if (validItems.length > 1) {
        const bounds = new mapboxgl.LngLatBounds();
        validItems.forEach(item => bounds.extend([item.longitude, item.latitude]));
        map.fitBounds(bounds, { padding: 40, maxZoom: 14 });
      }
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [items]);

  if (!MAPBOX_ACCESS_TOKEN) {
    return null;
  }

  const hasMappedItems = items.some(i => i.latitude !== null && i.longitude !== null);
  if (!hasMappedItems) {
    return null; // No need to show map if no items have locations
  }

  return (
    <div className="relative overflow-hidden rounded-[0.5rem] border border-border/70 mb-4">
      <div ref={mapContainerRef} className="h-[300px] w-full bg-muted/10" />
      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-border/60 bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span className="font-medium text-foreground">Community Input Map</span>
      </div>
    </div>
  );
}
