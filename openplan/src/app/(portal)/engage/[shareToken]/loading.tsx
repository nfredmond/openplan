/** Shown while a public engagement page loads, so a slow connection is not a blank screen. */
export default function PortalLoading() {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center px-6 text-base text-muted-foreground">
      Loading…
    </div>
  );
}
