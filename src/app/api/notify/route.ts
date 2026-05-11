import { Resend } from 'resend'
import { NextResponse } from 'next/server'

const resend = new Resend(process.env.RESEND_API_KEY)

export async function POST(request: Request) {
  const { clientName, fileCount, state, fiscalYear, assignedTo, token } = await request.json()

  const panelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/workspace`

  const { error } = await resend.emails.send({
    from: 'TaxFlow <onboarding@resend.dev>',
    to: process.env.NOTIFY_EMAIL!,
    subject: `📄 ${clientName} just uploaded ${fileCount} file${fileCount > 1 ? 's' : ''}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; background: #f9fafb; border-radius: 12px;">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 24px;">
          <div style="width: 8px; height: 8px; border-radius: 50%; background: #2563eb;"></div>
          <span style="font-size: 14px; font-weight: 500; color: #1f2937;">TaxFlow</span>
        </div>
        <h2 style="font-size: 18px; font-weight: 600; color: #1f2937; margin: 0 0 8px;">New documents uploaded</h2>
        <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px;">
          <strong style="color: #1f2937;">${clientName}</strong> just uploaded <strong style="color: #1f2937;">${fileCount} file${fileCount > 1 ? 's' : ''}</strong> to their file.
        </p>
        <div style="background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">State: <span style="color: #1f2937;">${state}</span></p>
          <p style="font-size: 12px; color: #6b7280; margin: 0 0 4px;">Tax year: <span style="color: #1f2937;">${fiscalYear}</span></p>
          <p style="font-size: 12px; color: #6b7280; margin: 0;">Assigned to: <span style="color: #1f2937;">${assignedTo || 'Unassigned'}</span></p>
        </div>
        <a href="${panelUrl}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 13px; font-weight: 500;">
          View in panel →
        </a>
        <p style="font-size: 11px; color: #9ca3af; margin-top: 24px;">TaxFlow · Automated notification</p>
      </div>
    `
  })

  if (error) {
    return NextResponse.json({ error }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}