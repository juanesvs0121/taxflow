import { NextResponse } from 'next/server'
import { getAdminClient, normalizeToken, findClientByToken } from '@/lib/portal-server'

// Tells the portal what to show for a link: 'new', 'returning' or 'invalid'.
// It never returns any client data.
export async function GET(request: Request) {
  try {
    const token = normalizeToken(new URL(request.url).searchParams.get('token'))
    if (!token) return NextResponse.json({ state: 'invalid' })

    const admin = getAdminClient()

    const client = await findClientByToken(admin, token)
    if (client) return NextResponse.json({ state: 'returning' })

    const { data: link, error } = await admin
      .from('client_links')
      .select('expires_at')
      .eq('token', token)
      .maybeSingle()
    if (error) throw error

    if (link && new Date(link.expires_at).getTime() > Date.now()) {
      return NextResponse.json({ state: 'new' })
    }

    return NextResponse.json({ state: 'invalid' })
  } catch (err) {
    console.error('portal/status error:', err)
    return NextResponse.json({ state: 'error' }, { status: 500 })
  }
}
