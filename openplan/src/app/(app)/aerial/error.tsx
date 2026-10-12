"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function AerialError({
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
      moduleName="Aerial Imagery"
      backHref="/aerial"
      backLabel="Back to Aerial Imagery"
      logTag="aerial-error"
    />
  );
}
