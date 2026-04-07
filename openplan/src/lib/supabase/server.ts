import { createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export class MissingEnvironmentVariableError extends Error {
  constructor(public readonly variableName: string) {
    super(`Missing required environment variable: ${variableName}`)
    this.name = 'MissingEnvironmentVariableError'
  }
}

function requireEnv(variableName: string): string {
  const value = process.env[variableName]?.trim()
  if (!value) {
    throw new MissingEnvironmentVariableError(variableName)
  }

  return value
}

export function isMissingEnvironmentVariableError(error: unknown): error is MissingEnvironmentVariableError {
  return error instanceof MissingEnvironmentVariableError
}

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {}
        },
      },
    }
  )
}

export function createServiceRoleClient() {
  return createSupabaseClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
