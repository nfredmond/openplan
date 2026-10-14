"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function PlansError({
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
      moduleName="Plans"
      backHref="/plans"
      backLabel="Back to Plans"
      logTag="plans-error"
    />
  );
}
