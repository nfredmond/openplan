type HistoryReadScope = {
  userId: string;
  workspaceId: string;
  signal?: AbortSignal;
  isCurrent: () => boolean;
};

/** Concurrent evidence reconstruction can briefly hold the same native lock.
 * Retry unavailable GETs only, with fresh authorization and no cached evidence.
 * Exhaustion returns the last unavailable response to the caller's normal error UI.
 */
export async function readSynthesisHistory(url: string, scope: HistoryReadScope): Promise<Response> {
  const assertCurrent = () => {
    scope.signal?.throwIfAborted();
    if (!scope.isCurrent()) throw new DOMException("This history read was superseded", "AbortError");
  };
  for (let attempt = 0; ; attempt++) {
    assertCurrent();
    const response = await fetch(url, { method: "GET", cache: "no-store", signal: scope.signal,
      headers: { "x-openplan-expected-user": scope.userId, "x-openplan-expected-workspace": scope.workspaceId } });
    assertCurrent();
    if (response.status !== 503 || attempt >= 2) return response;
    await response.body?.cancel();
    await new Promise<void>((resolve, reject) => {
      const finish = () => { scope.signal?.removeEventListener("abort", abort); resolve(); };
      const timer = setTimeout(finish, attempt === 0 ? 200 : 600);
      const abort = () => { clearTimeout(timer); scope.signal?.removeEventListener("abort", abort); reject(scope.signal?.reason); };
      scope.signal?.addEventListener("abort", abort, { once: true });
      if (scope.signal?.aborted) abort();
    });
  }
}
