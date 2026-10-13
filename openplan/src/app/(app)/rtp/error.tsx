"use client";

import { ModuleError } from "@/components/ui/module-error";

export default function RtpError({
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
      moduleName="Regional Plan (RTP)"
      backHref="/rtp"
      backLabel="Back to Regional Plan (RTP)"
      logTag="rtp-error"
    />
  );
}
