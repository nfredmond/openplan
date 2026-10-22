"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function ModelsError({
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
      moduleName="Models"
      backHref="/models"
      backLabel="Back to Models"
      logTag="models-error"
    />
  );
}
