"use client";

import { useCallback } from "react";
import Link from "next/link";

import { useCartographicSelection } from "./cartographic-context";
import type { CartographicInspectorSelection } from "./cartographic-inspector-dock";

type CartographicSelectionLinkProps = {
  href: string;
  selection: CartographicInspectorSelection;
  className?: string;
  children: React.ReactNode;
};

export function CartographicSelectionLink({
  href,
  selection,
  className,
  children,
}: CartographicSelectionLinkProps) {
  const { setSelection } = useCartographicSelection();

  const preview = useCallback(() => {
    setSelection(selection);
  }, [setSelection, selection]);

  return (
    <Link
      href={href}
      className={className}
      onMouseEnter={preview}
      onFocus={preview}
      onClick={preview}
    >
      {children}
    </Link>
  );
}
