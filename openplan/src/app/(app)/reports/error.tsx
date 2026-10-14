"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function ReportsError({
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
      moduleName="Reports"
      backHref="/reports"
      backLabel="Back to Reports"
      logTag="reports-error"
    />
  );
}
