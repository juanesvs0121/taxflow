// Server-only: sends the "new documents uploaded" email to the accountant.
// It is called by /api/portal/complete after the files have been verified,
// so it can no longer be triggered by anyone with a plain POST request.

import { Resend } from 'resend'

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

type UploadNotification = {
  clientName: string
  fileCount: number
  state: string | null
  fiscalYear: number | string | null
  assignedTo: string | null
}

export async function sendUploadNotification(params: UploadNotification) {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.NOTIFY_EMAIL

  if (!apiKey || !to) {
    console.error('Notification skipped: RESEND_API_KEY or NOTIFY_EMAIL is not set')
    return
  }

  const resend = new Resend(apiKey)
  const plural = params.fileCount > 1 ? 's' : ''
  const panelUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/workspace`

  const name = escapeHtml(params.clientName)
  const state = escapeHtml(params.state || '—')
  const fiscalYear = escapeHtml(params.fiscalYear ?? '—')
  const assignedTo = escapeHtml(params.assignedTo || 'Unassigned')
  const url = escapeHtml(panelUrl)

  const { error } = await resend.emails.send({
    from: 'TaxFlow <onboarding@resend.dev>',
    to,
    subject: `📄 ${params.clientName} just uploaded ${params.fileCount} file${plural}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9fafb; border-radius: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 24px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #2563eb;"></div>
          <span style="font-size: 14px; font-weight: 500; color: #1f2937;">TaxFlow</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 8px;">New documents uploaded</h2>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          <strong style="color: #1f2937;">${name}</strong> just uploaded <strong style="color: #1f2937;">${params.fileCount} file${plural}</strong> to their file.
        </p>
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">State: <span style="color: #1f2937;">${state}</span></p>
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">Tax year: <span style="color: #1f2937;">${fiscalYear}</span></p>
          <p style="font-size: 12px; color: #6b7280; margin: 0;">Assigned to: <span style="color: #1f2937;">${assignedTo}</span></p>
        </div>
        <a href="${url}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
          View in panel →
        </a>
        <p style="font-size: 11px; color: #9ca3af; margin-top: 24px;">TaxFlow · Automated notification</p>
      </div>
    `,
  })

  if (error) {
    console.error('Resend error:', error)
  }
}
