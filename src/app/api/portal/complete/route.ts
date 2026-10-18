import { NextResponse } from 'next/server'
import {
  BUCKET,
  MAX_FILES_PER_SUBMIT,
  getAdminClient,
  normalizeToken,
  verifyClient,
  cleanText,
  sleep,
} from '@/lib/portal-server'
import { sendUploadNotification } from '@/lib/notify'

type Upload = { path: string; name: string }

// Called after the browser finished uploading. It re-verifies the client, checks that
// every file really exists in Storage inside that client's own folder, registers them
// in the documents table and sends the notification email.
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = normalizeToken(body?.token)

    if (!token || !Array.isArray(body?.uploads) || body.uploads.length === 0) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }

    const admin = getAdminClient()
    const client = await verifyClient(admin, token, body?.identifier)
    if (!client) {
      await sleep(400)
      return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
    }

    const prefix = `${client.id}/`

    // Only flat files inside the client's own folder are accepted.
    const requested: Upload[] = (body.uploads as unknown[])
      .slice(0, MAX_FILES_PER_SUBMIT)
      .map(item => {
        const raw = item as { path?: unknown; name?: unknown }
        return {
          path: typeof raw?.path === 'string' ? raw.path : '',
          name: cleanText(raw?.name, 255),
        }
      })
      .filter(
        u =>
          u.name &&
          u.path.length <= 300 &&
          u.path.startsWith(prefix) &&
          !u.path.includes('..') &&
          !u.path.slice(prefix.length).includes('/')
      )

    if (requested.length === 0) {
      return NextResponse.json({ error: 'No valid files.' }, { status: 400 })
    }

    // Make sure the files were really uploaded.
    const { data: objects, error: listError } = await admin.storage
      .from(BUCKET)
      .list(client.id, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } })
    if (listError) throw listError

    const existingNames = new Set((objects ?? []).map(o => o.name))
    const found = requested.filter(u => existingNames.has(u.path.slice(prefix.length)))

    // Skip files that were already registered (makes retries safe).
    const { data: alreadyRows, error: alreadyError } = await admin
      .from('documents')
      .select('file_path')
      .in('file_path', found.map(u => u.path))
    if (alreadyError) throw alreadyError

    const alreadySet = new Set((alreadyRows ?? []).map(r => r.file_path as string))
    const toInsert = found
      .filter(u => !alreadySet.has(u.path))
      .map(u => ({ client_id: client.id, file_name: u.name, file_path: u.path }))

    if (toInsert.length > 0) {
      const { error: insertError } = await admin.from('documents').insert(toInsert)
      if (insertError) throw insertError
    }

    // Notes from a returning client are appended to the existing client notes.
    const notes = cleanText(body?.notes, 2000, true)
    if (notes && toInsert.length + alreadySet.size > 0) {
      const merged = client.notes ? `${client.notes}\n\n${notes}` : notes
      const { error: notesError } = await admin
        .from('clients')
        .update({ notes: merged.slice(0, 6000) })
        .eq('id', client.id)
      if (notesError) console.error('portal/complete notes error:', notesError)
    }

    if (toInsert.length > 0) {
      try {
        await sendUploadNotification({
          clientName: `${client.first_name} ${client.last_name}`,
          fileCount: toInsert.length,
          state: client.state,
          fiscalYear: client.fiscal_year,
          assignedTo: client.assigned_to,
        })
      } catch (err) {
        console.error('portal/complete notification error:', err)
      }
    }

    return NextResponse.json({
      ok: true,
      saved: toInsert.length,
      alreadySaved: alreadySet.size,
      missing: requested.length - found.length,
    })
  } catch (err) {
    console.error('portal/complete error:', err)
    return NextResponse.json(
      { error: 'We could not save your documents. Please try again.' },
      { status: 500 }
    )
  }
}
