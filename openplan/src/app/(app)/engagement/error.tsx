"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function EngagementError({
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
      moduleName="Engagement"
      backHref="/engagement"
      backLabel="Back to Engagement"
      logTag="engagement-error"
    />
  );
}
