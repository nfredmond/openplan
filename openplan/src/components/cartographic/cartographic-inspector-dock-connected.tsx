"use client";

import { useCartographicSelection } from "./cartographic-context";
import { CartographicInspectorDock } from "./cartographic-inspector-dock";

export function CartographicInspectorDockConnected() {
  const { selection, clearSelection } = useCartographicSelection();
  return <CartographicInspectorDock selection={selection} onClose={clearSelection} />;
}
