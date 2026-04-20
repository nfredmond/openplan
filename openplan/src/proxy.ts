import { type NextRequest, NextResponse } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'

const PROTECTED_ROUTE_PREFIXES = [
  '/dashboard',
  '/workspace',
  '/projects',
  '/rtp',
  '/plans',
  '/programs',
  '/models',
  '/scenarios',
  '/explore',
  '/data-hub',
  '/reports',
  '/grants',
  '/engagement',
  '/billing',
  '/admin',
] as const

const REQUEST_ID_HEADER = 'x-request-id'

function isProtectedRoute(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

function resolveRequestId(request: NextRequest): string {
  const incoming = request.headers.get(REQUEST_ID_HEADER)
  if (incoming && incoming.trim().length > 0) return incoming.trim()
  return crypto.randomUUID()
}

export async function proxy(request: NextRequest) {
  const requestId = resolveRequestId(request)
  request.headers.set(REQUEST_ID_HEADER, requestId)

  const { response, user } = await updateSession(request)

  const pathname = request.nextUrl.pathname
  if (!user && isProtectedRoute(pathname)) {
    const signInUrl = request.nextUrl.clone()
    signInUrl.pathname = '/sign-in'
    signInUrl.searchParams.set('redirect', `${pathname}${request.nextUrl.search}`)
    const redirect = NextResponse.redirect(signInUrl)
    redirect.headers.set(REQUEST_ID_HEADER, requestId)
    return redirect
  }

  response.headers.set(REQUEST_ID_HEADER, requestId)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
