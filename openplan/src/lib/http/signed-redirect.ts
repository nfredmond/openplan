import { NextResponse } from "next/server";

/**
 * Redirect to a short-lived signed Storage URL. The Location header is a bearer
 * link to private content until it expires, so neither the browser nor a
 * shared cache may store the redirect and replay it to anyone else.
 */
export function signedStorageRedirect(signedUrl: string): NextResponse {
  const response = NextResponse.redirect(signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
