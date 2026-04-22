"use client";

import { useCartographicSelection } from "./cartographic-context";
import { CartographicInspectorDock } from "./cartographic-inspector-dock";
import { useEscapeToClearSelection } from "./use-escape-to-clear-selection";

export function CartographicInspectorDockConnected() {
  const { selection, clearSelection } = useCartographicSelection();
  useEscapeToClearSelection({ enabled: selection !== null, onClear: clearSelection });
  return <CartographicInspectorDock selection={selection} onClose={clearSelection} />;
}
