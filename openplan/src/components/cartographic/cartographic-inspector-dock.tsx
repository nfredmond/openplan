"use client";

import { X } from "lucide-react";

export type CartographicInspectorSelection = {
  kind: "project" | "run" | "mission" | "report" | "corridor" | "rtp" | "census_tract";
  title: string;
  kicker?: string;
  avatarChar?: string;
  meta?: Array<{ label: string; value: string; tone?: "default" | "urgent" | "ok" | "warn" }>;
  primaryAction?: { label: string; onClick: () => void };
  secondaryAction?: { label: string; onClick: () => void };
  // Optional round-trip reference so Mapbox can highlight the selected feature.
  // Backdrop-agnostic; consumers that don't know about the map layer omit it.
  featureRef?: { sourceId: string; featureId: string | number };
};

type CartographicInspectorDockProps = {
  selection: CartographicInspectorSelection | null;
  onClose?: () => void;
};

export function CartographicInspectorDock({
  selection,
  onClose,
}: CartographicInspectorDockProps) {
  const hidden = !selection;

  return (
    <div
      className={`op-cart-inspector ${hidden ? "is-hidden" : ""}`}
      aria-hidden={hidden}
      role="region"
      aria-label="Selection details"
    >
      {selection ? (
        <>
          <div className="op-cart-inspector__avatar" aria-hidden>
            {selection.avatarChar ?? selection.title[0]}
          </div>
          <div className="op-cart-inspector__body">
            {selection.kicker ? (
              <div className="op-cart-inspector__kicker">{selection.kicker}</div>
            ) : null}
            <div className="op-cart-inspector__title">{selection.title}</div>
            {selection.meta && selection.meta.length > 0 ? (
              <div className="op-cart-inspector__meta">
                {selection.meta.map((item) => (
                  <span key={item.label} className={`op-cart-inspector__meta-item tone-${item.tone ?? "default"}`}>
                    <strong>{item.value}</strong> {item.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          <div className="op-cart-inspector__actions">
            {selection.secondaryAction ? (
              <button
                type="button"
                className="op-cart-btn"
                onClick={selection.secondaryAction.onClick}
              >
                {selection.secondaryAction.label}
              </button>
            ) : null}
            {selection.primaryAction ? (
              <button
                type="button"
                className="op-cart-btn op-cart-btn--primary"
                onClick={selection.primaryAction.onClick}
              >
                {selection.primaryAction.label}
              </button>
            ) : null}
            {onClose ? (
              <button
                type="button"
                className="op-cart-btn op-cart-btn--icon"
                onClick={onClose}
                aria-label="Dismiss selection"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
