"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function AppError({
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
      backHref="/dashboard"
      backLabel="Back to the dashboard"
      logTag="app-error"
    />
  );
}
