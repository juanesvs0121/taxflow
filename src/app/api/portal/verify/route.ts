import { NextResponse } from 'next/server'
import { getAdminClient, normalizeToken, verifyClient, sleep } from '@/lib/portal-server'

// Checks that the person who opened the link knows the client's email or phone.
// The comparison happens here, on the server, and nothing about the client is returned.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = normalizeToken(body?.token)
    if (!token) return NextResponse.json({ ok: false }, { status: 400 })

    const admin = getAdminClient()
    const client = await verifyClient(admin, token, body?.identifier)

    if (!client) {
      // Small delay to make guessing attempts slower.
      await sleep(400)
      return NextResponse.json({ ok: false }, { status: 401 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('portal/verify error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
