// Server-only helpers for the client portal.
// IMPORTANT: this file uses the service role key, which bypasses RLS.
// Never import it from a file that starts with 'use client'.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const BUCKET = 'documents'
export const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB, same limit as the bucket
export const MAX_FILES_PER_SUBMIT = 25

export type PortalClient = {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  state: string | null
  fiscal_year: number | string | null
  assigned_to: string | null
  notes: string | null
}

export function getAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Accepts the old 8-character tokens and the new long random ones.
export function normalizeToken(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const token = value.trim()
  return /^[A-Za-z0-9_-]{8,64}$/.test(token) ? token : null
}

function stripControlChars(value: string, keepNewlines: boolean): string {
  let out = ''
  for (const ch of value) {
    const code = ch.charCodeAt(0)
    const isControl = code < 32 || code === 127
    const isAllowedNewline = keepNewlines && (code === 9 || code === 10 || code === 13)
    out += isControl && !isAllowedNewline ? ' ' : ch
  }
  return out
}

export function cleanText(value: unknown, max: number, multiline = false): string {
  if (typeof value !== 'string') return ''
  return stripControlChars(value, multiline).trim().slice(0, max)
}

export function sanitizeFileName(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '')
  return safe.slice(-120) || 'file'
}

export async function findClientByToken(
  admin: SupabaseClient,
  token: string
): Promise<PortalClient | null> {
  const { data, error } = await admin
    .from('clients')
    .select('id, first_name, last_name, email, phone, state, fiscal_year, assigned_to, notes')
    .eq('token', token)
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return (data?.[0] as PortalClient | undefined) ?? null
}

// Exact comparison done on the server (no query-string filters built from user input).
function identifierMatches(client: PortalClient, identifier: unknown): boolean {
  if (typeof identifier !== 'string') return false
  const value = identifier.trim().toLowerCase()
  if (!value || value.length > 254) return false

  if (value.includes('@')) {
    return (client.email ?? '').trim().toLowerCase() === value
  }

  const digits = value.replace(/\D/g, '')
  const clientDigits = (client.phone ?? '').replace(/\D/g, '')
  return digits.length >= 7 && digits === clientDigits
}

export async function verifyClient(
  admin: SupabaseClient,
  token: string,
  identifier: unknown
): Promise<PortalClient | null> {
  const client = await findClientByToken(admin, token)
  if (!client) return null
  return identifierMatches(client, identifier) ? client : null
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
