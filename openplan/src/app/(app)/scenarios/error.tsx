"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function ScenariosError({
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
      moduleName="Scenarios"
      backHref="/scenarios"
      backLabel="Back to Scenarios"
      logTag="scenarios-error"
    />
  );
}
