"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

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
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
          (element) => element.getAttribute("aria-hidden") !== "true"
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable.at(-1);
        if ((!event.shiftKey && document.activeElement === last) ||
            (event.shiftKey && document.activeElement === first)) {
          event.preventDefault();
          (event.shiftKey ? last : first)?.focus();
        }
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
