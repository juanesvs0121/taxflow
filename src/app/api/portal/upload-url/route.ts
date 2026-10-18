import { NextResponse } from 'next/server'
import {
  BUCKET,
  MAX_FILE_SIZE,
  MAX_FILES_PER_SUBMIT,
  getAdminClient,
  normalizeToken,
  verifyClient,
  cleanText,
  sanitizeFileName,
  sleep,
} from '@/lib/portal-server'

// Verifies the client and returns one signed upload URL per file.
// The browser then uploads each file straight to Storage with that signed token,
// so the files never go through this function (Vercel limits request bodies to ~4.5 MB).
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null)
    const token = normalizeToken(body?.token)
    const files = body?.files

    if (!token || !Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
    }
    if (files.length > MAX_FILES_PER_SUBMIT) {
      return NextResponse.json(
        { error: `Please upload up to ${MAX_FILES_PER_SUBMIT} files at a time.` },
        { status: 400 }
      )
    }

    for (const file of files) {
      const name = cleanText(file?.name, 255)
      const size = Number(file?.size)
      if (!name || !Number.isFinite(size) || size < 0) {
        return NextResponse.json({ error: 'Invalid file.' }, { status: 400 })
      }
      if (size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `"${name}" is larger than 20 MB.` },
          { status: 400 }
        )
      }
    }

    const admin = getAdminClient()
    const client = await verifyClient(admin, token, body?.identifier)
    if (!client) {
      await sleep(400)
      return NextResponse.json({ error: 'Not authorized.' }, { status: 401 })
    }

    const uploads: { path: string; token: string; name: string }[] = []
    const stamp = Date.now()

    for (let i = 0; i < files.length; i++) {
      const originalName = cleanText(files[i].name, 255)
      const path = `${client.id}/${stamp}_${i}_${sanitizeFileName(originalName)}`

      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error || !data) throw error ?? new Error('Could not create signed upload URL')

      uploads.push({ path: data.path, token: data.token, name: originalName })
    }

    return NextResponse.json({ uploads })
  } catch (err) {
    console.error('portal/upload-url error:', err)
    return NextResponse.json(
      { error: 'We could not prepare the upload. Please try again.' },
      { status: 500 }
    )
  }
}
