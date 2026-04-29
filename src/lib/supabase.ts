import { createBrowserClient } from '@supabase/ssr'

export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export type Client = {
  id: string
  token: string
  first_name: string
  last_name: string
  email: string
  phone: string
  state: string
  fiscal_year: number
  marital_status: string
  notes: string | null
  status: 'pending' | 'in_progress' | 'complete'
  assigned_to: string
  archived: boolean
  created_at: string
}

export type Document = {
  id: string
  client_id: string
  file_name: string
  file_path: string
  uploaded_at: string
}