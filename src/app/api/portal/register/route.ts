import { NextResponse } from 'next/server'
import { getAdminClient, normalizeToken, findClientByToken, cleanText } from '@/lib/portal-server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Creates the client record for a NEW link. The link must exist in client_links,
// must not be expired and must not have been used before.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = normalizeToken(body?.token)
    const form = body?.form

    if (!token || !form || typeof form !== 'object') {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const first_name = cleanText(form.first_name, 80)
    const last_name = cleanText(form.last_name, 80)
    const email = cleanText(form.email, 254)
    const phone = cleanText(form.phone, 40)
    const state = cleanText(form.state, 40)
    const marital_status = cleanText(form.marital_status, 60)
    const notes = cleanText(form.notes, 2000, true)
    const fiscal_year = Number.parseInt(String(form.fiscal_year), 10)

    if (!first_name || !last_name || !EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: 'Please check your name and email.' },
        { status: 400 }
      )
    }
    if (!Number.isInteger(fiscal_year) || fiscal_year < 2000 || fiscal_year > 2100) {
      return NextResponse.json({ error: 'Invalid tax year.' }, { status: 400 })
    }

    const admin = getAdminClient()

    if (await findClientByToken(admin, token)) {
      return NextResponse.json(
        { error: 'This link has already been used.' },
        { status: 409 }
      )
    }

    const { data: link, error: linkError } = await admin
      .from('client_links')
      .select('expires_at')
      .eq('token', token)
      .maybeSingle()
    if (linkError) throw linkError

    if (!link || new Date(link.expires_at).getTime() <= Date.now()) {
      return NextResponse.json(
        { error: 'This link is not valid or has expired.' },
        { status: 403 }
      )
    }

    const { error: insertError } = await admin.from('clients').insert([
      {
        first_name,
        last_name,
        email,
        phone,
        state,
        marital_status,
        notes,
        fiscal_year,
        token,
      },
    ])
    if (insertError) throw insertError

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('portal/register error:', err)
    return NextResponse.json(
      { error: 'We could not save your information. Please try again.' },
      { status: 500 }
    )
  }
}
