"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Shared native-modal shell for non-destructive, content-rich workflows. */
export function ModalDialog({
  children,
  titleId,
  descriptionId,
  onRequestClose,
  closeBlocked = false,
  initialFocusRef,
  className,
}: {
  children: ReactNode;
  titleId: string;
  descriptionId?: string;
  onRequestClose: () => void;
  closeBlocked?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  );

  useEffect(() => {
    dialogRef.current?.showModal();
    initialFocusRef?.current?.focus();
    const returnTo = returnFocusRef.current;
    return () => {
      if (returnTo && document.contains(returnTo)) returnTo.focus();
    };
  }, [initialFocusRef]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!closeBlocked) onRequestClose();
      }}
      className={cn(
        "m-auto overflow-hidden rounded-[0.5rem] border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/50",
        className
      )}
    >
      {children}
    </dialog>,
    document.body
  );
}
