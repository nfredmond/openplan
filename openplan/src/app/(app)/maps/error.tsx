"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function MapsError({
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
      moduleName="Maps"
      backHref="/maps"
      backLabel="Back to Maps"
      logTag="maps-error"
    />
  );
}
