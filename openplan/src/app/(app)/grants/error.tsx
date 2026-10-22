"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function GrantsError({
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
      moduleName="Grants"
      backHref="/grants"
      backLabel="Back to Grants"
      logTag="grants-error"
    />
  );
}
