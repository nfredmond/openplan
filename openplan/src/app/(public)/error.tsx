"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function PublicError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ModuleError
      error={error}
      reset={reset}
      backHref="/"
      backLabel="Home"
      logTag="public-error"
      as="main"
    />
  );
}
