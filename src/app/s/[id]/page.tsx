'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDropzone, type FileRejection } from 'react-dropzone'

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const MAX_FILES = 25

type LinkState = 'checking' | 'new' | 'returning' | 'invalid' | 'error'
type PendingUpload = { path: string; name: string }

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  return { ok: res.ok, status: res.status, data }
}

export default function ClientPage() {
  const { id: token } = useParams<{ id: string }>()
  const [step, setStep] = useState(1)
  const [animating, setAnimating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [linkState, setLinkState] = useState<LinkState>('checking')
  const [verifyInput, setVerifyInput] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [verified, setVerified] = useState(false)
  // What the server uses to re-check who is uploading: the email/phone typed by a
  // returning client, or the email of a client who just registered.
  const [identifier, setIdentifier] = useState('')
  const [registered, setRegistered] = useState(false)
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [fileNotice, setFileNotice] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    state: '',
    fiscal_year: '2025',
    marital_status: '',
    notes: ''
  })

  const isReturning = linkState === 'returning'

  // The server tells us if the link is new, belongs to an existing client, or is invalid.
  // No client data is sent to the browser at this point.
  useEffect(() => {
    let cancelled = false
    const checkLink = async () => {
      try {
        const res = await fetch(`/api/portal/status?token=${encodeURIComponent(token)}`)
        const data = await res.json()
        if (cancelled) return
        const state = data?.state
        setLinkState(state === 'new' || state === 'returning' || state === 'invalid' ? state : 'error')
      } catch {
        if (!cancelled) setLinkState('error')
      }
      if (!cancelled) setTimeout(() => setVisible(true), 80)
    }
    checkLink()
    return () => { cancelled = true }
  }, [token])

  const goToStep = (next: number) => {
    setAnimating(true)
    setTimeout(() => {
      setStep(next)
      setAnimating(false)
    }, 300)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    maxSize: MAX_FILE_SIZE,
    onDrop: useCallback((accepted: File[], rejections: FileRejection[]) => {
      setFiles(prev => [...prev, ...accepted])
      if (rejections.length > 0) {
        const names = rejections.map(r => r.file.name).join(', ')
        setFileNotice(`Not added (larger than 20 MB): ${names}`)
      } else {
        setFileNotice('')
      }
    }, [])
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleVerify = async () => {
    const value = verifyInput.trim()
    if (!value) return
    setVerifying(true)
    setVerifyError('')
    try {
      const { ok } = await postJson('/api/portal/verify', { token, identifier: value })
      if (ok) {
        setIdentifier(value)
        setVerified(true)
        goToStep(2)
      } else {
        setVerifyError('We could not verify your identity. Please check your email or phone number.')
      }
    } catch {
      setVerifyError('Something went wrong. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  const emailsMatch = form.email === confirmEmail
  const canContinue = form.first_name && form.last_name && form.email && confirmEmail && emailsMatch && confirmed

  const handleSubmit = async () => {
    if (files.length === 0 && pendingUploads.length === 0) return
    if (files.length > MAX_FILES) {
      setSubmitError(`Please upload up to ${MAX_FILES} files at a time.`)
      return
    }

    setLoading(true)
    setSubmitError('')

    try {
      let proof = identifier

      // New client: create the record once (the server checks that the link is valid).
      if (linkState === 'new' && !registered) {
        const reg = await postJson('/api/portal/register', { token, form })
        if (!reg.ok) throw new Error(reg.data?.error || 'We could not save your information.')
        setRegistered(true)
        setIdentifier(form.email)
        proof = form.email
      }

      const succeeded: PendingUpload[] = []
      const failed: File[] = []

      if (files.length > 0) {
        const prep = await postJson('/api/portal/upload-url', {
          token,
          identifier: proof,
          files: files.map(f => ({ name: f.name, size: f.size }))
        })
        if (!prep.ok) throw new Error(prep.data?.error || 'We could not prepare the upload.')

        const targets = prep.data.uploads as { path: string; token: string; name: string }[]
        setProgress({ done: 0, total: files.length })

        for (let i = 0; i < files.length; i++) {
          const target = targets[i]
          const { error } = await supabase.storage
            .from('documents')
            .uploadToSignedUrl(target.path, target.token, files[i])
          if (error) failed.push(files[i])
          else succeeded.push({ path: target.path, name: files[i].name })
          setProgress({ done: i + 1, total: files.length })
        }
      }

      // Files that already went up are never uploaded twice: only the failed ones stay in the list.
      setFiles(failed)
      const toComplete = [...pendingUploads, ...succeeded]
      setPendingUploads(toComplete)

      if (toComplete.length > 0) {
        const done = await postJson('/api/portal/complete', {
          token,
          identifier: proof,
          uploads: toComplete,
          notes: isReturning ? form.notes : ''
        })
        const saved = Number(done.data?.saved ?? 0) + Number(done.data?.alreadySaved ?? 0)
        if (!done.ok || saved === 0) {
          throw new Error('Your files were uploaded but could not be saved. Please press Submit again.')
        }
        setPendingUploads([])
      }

      if (failed.length > 0) {
        setSubmitError(`These files could not be uploaded: ${failed.map(f => f.name).join(', ')}. Please press Submit to try again.`)
        return
      }

      goToStep(3)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Error submitting your information. Please try again.')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  const bg = darkMode ? 'bg-[#0f0f0f]' : 'bg-[#fafaf8]'
  const cardBg = darkMode ? 'bg-[#161616]' : 'bg-white'
  const cardInner = darkMode ? 'bg-[#1e1e1e]' : 'bg-[#fafaf8]'
  const borderColor = darkMode ? 'border-white/5' : 'border-stone-100'
  const textPrimary = darkMode ? 'text-white/90' : 'text-stone-800'
  const textSecondary = darkMode ? 'text-white/50' : 'text-stone-500'
  const textTertiary = darkMode ? 'text-white/30' : 'text-stone-400'
  const inputClass = darkMode
    ? 'bg-white/5 border-white/10 text-white/90 placeholder-white/20'
    : 'bg-[#fafaf8] border-stone-200 text-stone-800 placeholder-stone-300'

  if (linkState === 'checking') {
    return (
      <main className={`min-h-screen ${bg} flex items-center justify-center`}>
        <p className={`text-sm ${textSecondary}`}>Loading...</p>
      </main>
    )
  }

  if (linkState === 'invalid' || linkState === 'error') {
    return (
      <main className={`min-h-screen ${bg} flex items-center justify-center px-4`}>
        <div className={`${cardBg} border ${borderColor} rounded-2xl p-8 max-w-sm w-full text-center border-t-2 border-t-amber-400`}>
          <span className={`text-xl font-medium tracking-tight ${textPrimary}`}>
            Tax<span className="text-emerald-500">Flow</span>
          </span>
          <h1 className={`text-base font-medium mt-5 mb-2 ${textPrimary}`}>
            {linkState === 'invalid' ? 'This link is not valid' : 'Something went wrong'}
          </h1>
          <p className={`text-sm leading-relaxed ${textSecondary}`}>
            {linkState === 'invalid'
              ? 'The link may have expired or been copied incorrectly. Please contact your accountant to get a new one.'
              : 'We could not load this page. Please refresh and try again in a moment.'}
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className={`min-h-screen ${bg} py-10 px-4 transition-colors duration-300`}>
      <div className={`max-w-xl mx-auto transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex-1 text-center">
            <span className={`text-xl font-medium tracking-tight ${textPrimary}`}>
              Tax<span className="text-emerald-500">Flow</span>
            </span>
            <p className={`text-xs mt-1 ${textSecondary}`}>Submit your documents securely</p>
          </div>
          <button
            onClick={() => {
              const next = !darkMode
              setDarkMode(next)
              localStorage.setItem('darkMode', String(next))
            }}
            className={`p-2 rounded-lg border transition-colors ${darkMode ? 'border-white/10 bg-white/5 text-white/50' : 'border-stone-200 bg-white text-stone-400'}`}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>

        {/* Progress bar */}
        {!isReturning && step < 3 && (
          <div className="mb-6">
            <div className={`w-full h-1 rounded-full ${darkMode ? 'bg-white/10' : 'bg-stone-100'} overflow-hidden`}>
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: step === 1 ? '50%' : '100%' }}
              />
            </div>
            <p className={`text-[10px] text-right mt-1 ${textTertiary}`}>Step {step} of 2</p>
          </div>
        )}

        <div className={`transition-all duration-300 ${animating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>

          {/* Welcome back */}
          {isReturning && !verified && (
            <div className={`${cardBg} border ${borderColor} rounded-2xl p-6 border-t-2 border-t-emerald-500`}>
              <p className={`text-sm font-medium mb-1 ${textPrimary}`}>Welcome back!</p>
              <p className={`text-xs mb-5 ${textSecondary}`}>Enter your email or phone number to access your file.</p>
              <input
                value={verifyInput}
                onChange={e => setVerifyInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleVerify()}
                placeholder="Email or phone number"
                className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none mb-3 ${inputClass}`}
              />
              {verifyError && <p className="text-xs text-red-400 mb-3">{verifyError}</p>}
              <button
                onClick={handleVerify}
                disabled={verifying || !verifyInput.trim()}
                className="w-full bg-[#1c1c1e] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40"
              >
                {verifying ? 'Verifying...' : 'Verify identity'}
              </button>
            </div>
          )}

          {/* Step 1 */}
          {!isReturning && step === 1 && (
            <div className={`${cardBg} border ${borderColor} rounded-2xl p-6 border-t-2 border-t-emerald-500`}>
              <p className={`text-[10px] font-medium uppercase tracking-widest mb-4 ${textSecondary}`}>Personal information</p>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>First name</label>
                  <input name="first_name" value={form.first_name} onChange={handleChange} placeholder="John" className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`} />
                </div>
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Last name</label>
                  <input name="last_name" value={form.last_name} onChange={handleChange} placeholder="Smith" className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Email</label>
                  <input name="email" value={form.email} onChange={handleChange} placeholder="john@email.com" className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`} />
                </div>
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Confirm email</label>
                  <input
                    value={confirmEmail}
                    onChange={e => setConfirmEmail(e.target.value)}
                    placeholder="john@email.com"
                    className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass} ${confirmEmail && !emailsMatch ? 'border-red-400' : confirmEmail && emailsMatch ? 'border-emerald-400' : ''}`}
                  />
                  {confirmEmail && !emailsMatch && <p className="text-[10px] text-red-400 mt-1">Emails do not match</p>}
                  {confirmEmail && emailsMatch && <p className="text-[10px] text-emerald-500 mt-1">✓ Emails match</p>}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Phone</label>
                  <input name="phone" value={form.phone} onChange={handleChange} placeholder="+1 555 000 0000" className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`} />
                </div>
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>State of residence</label>
                  <select name="state" value={form.state} onChange={handleChange} className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`}>
                    <option value="">Select...</option>
                    <option>Alabama</option><option>Alaska</option><option>Arizona</option>
                    <option>Arkansas</option><option>California</option><option>Colorado</option>
                    <option>Connecticut</option><option>Delaware</option><option>Florida</option>
                    <option>Georgia</option><option>Hawaii</option><option>Idaho</option>
                    <option>Illinois</option><option>Indiana</option><option>Iowa</option>
                    <option>Kansas</option><option>Kentucky</option><option>Louisiana</option>
                    <option>Maine</option><option>Maryland</option><option>Massachusetts</option>
                    <option>Michigan</option><option>Minnesota</option><option>Mississippi</option>
                    <option>Missouri</option><option>Montana</option><option>Nebraska</option>
                    <option>Nevada</option><option>New Hampshire</option><option>New Jersey</option>
                    <option>New Mexico</option><option>New York</option><option>North Carolina</option>
                    <option>North Dakota</option><option>Ohio</option><option>Oklahoma</option>
                    <option>Oregon</option><option>Pennsylvania</option><option>Rhode Island</option>
                    <option>South Carolina</option><option>South Dakota</option><option>Tennessee</option>
                    <option>Texas</option><option>Utah</option><option>Vermont</option>
                    <option>Virginia</option><option>Washington</option><option>West Virginia</option>
                    <option>Wisconsin</option><option>Wyoming</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-4">
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Tax year</label>
                  <select name="fiscal_year" value={form.fiscal_year} onChange={handleChange} className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`}>
                    <option>2025</option><option>2024</option><option>2023</option>
                  </select>
                </div>
                <div>
                  <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Marital status</label>
                  <select name="marital_status" value={form.marital_status} onChange={handleChange} className={`w-full border rounded-xl px-3 py-2 text-sm outline-none ${inputClass}`}>
                    <option value="">Select...</option>
                    <option>Single</option>
                    <option>Married (joint return)</option>
                    <option>Married (separate return)</option>
                    <option>Head of household</option>
                  </select>
                </div>
              </div>

              {/* Confirmation box */}
              {form.first_name && form.last_name && form.email && emailsMatch && (
                <div className={`${cardInner} border ${borderColor} rounded-xl p-4 mb-4 border-l-2 border-l-emerald-500`}>
                  <p className={`text-[10px] font-medium uppercase tracking-widest mb-3 ${textSecondary}`}>Please confirm your information</p>
                  <div className="space-y-1.5 mb-3">
                    {[
                      { label: 'Name', value: `${form.first_name} ${form.last_name}` },
                      { label: 'Email', value: form.email },
                      { label: 'Phone', value: form.phone || '—' },
                      { label: 'State', value: form.state || '—' },
                      { label: 'Tax year', value: form.fiscal_year },
                    ].map(item => (
                      <div key={item.label} className="flex items-center gap-2">
                        <span className={`text-[10px] w-14 flex-shrink-0 ${textTertiary}`}>{item.label}</span>
                        <span className={`text-xs ${textPrimary}`}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={e => setConfirmed(e.target.checked)}
                      className="w-4 h-4 rounded accent-emerald-500"
                    />
                    <span className={`text-xs ${textSecondary}`}>I confirm my information is correct</span>
                  </label>
                </div>
              )}

              <p className={`text-[10px] leading-relaxed mb-3 ${textTertiary}`}>
                We collect this information only to prepare your tax return. It is stored securely and shared only with your accountant&apos;s team.
              </p>

              <button
                onClick={() => goToStep(2)}
                disabled={!canContinue}
                className="w-full bg-[#1c1c1e] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          )}

          {/* Step 2 */}
          {((!isReturning && step === 2) || (isReturning && verified && step === 2)) && (
            <div className={`${cardBg} border ${borderColor} rounded-2xl p-6 border-t-2 border-t-emerald-500`}>
              <p className={`text-[10px] font-medium uppercase tracking-widest mb-4 ${textSecondary}`}>Upload your files</p>

              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                  isDragActive
                    ? 'border-emerald-400 bg-emerald-50'
                    : darkMode
                    ? 'border-white/10 hover:bg-white/5'
                    : 'border-stone-200 hover:bg-stone-50'
                }`}
              >
                <input {...getInputProps()} />
                <div className={`w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center ${darkMode ? 'bg-white/5' : 'bg-stone-100'}`}>
                  <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <p className={`text-sm ${textSecondary}`}>
                  <span className="text-emerald-500 font-medium">Click here</span> or drag your files
                </p>
                <p className={`text-xs mt-1 ${textTertiary}`}>Any file type · Max 20MB per file</p>
              </div>

              {fileNotice && <p className="text-xs text-amber-600 mb-3">{fileNotice}</p>}

              {files.length > 0 && (
                <div className={`${cardInner} border ${borderColor} rounded-xl p-3 mb-4`}>
                  <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${textTertiary}`}>{files.length} file{files.length !== 1 ? 's' : ''} selected</p>
                  {files.map((f, i) => (
                    <div key={i} className={`flex items-center justify-between py-1.5 ${i > 0 ? `border-t ${borderColor}` : ''}`}>
                      <span className={`text-xs truncate flex-1 ${textSecondary}`}>{f.name}</span>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-[10px] text-red-400 hover:text-red-600 ml-3 flex-shrink-0">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              {pendingUploads.length > 0 && (
                <p className={`text-xs mb-3 ${textSecondary}`}>
                  {pendingUploads.length} file{pendingUploads.length !== 1 ? 's' : ''} already uploaded. Press Submit to finish.
                </p>
              )}

              <div className="mb-4">
                <label className={`text-[10px] uppercase tracking-widest block mb-1.5 ${textTertiary}`}>Notes for your accountant (optional)</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Ex: The March receipt is from the dentist..."
                  className={`w-full border rounded-xl px-3 py-2 text-sm outline-none resize-none ${inputClass}`}
                />
              </div>

              {submitError && <p className="text-xs text-red-400 mb-3">{submitError}</p>}

              <div className="flex gap-3">
                {!isReturning && !registered && (
                  <button onClick={() => goToStep(1)} className={`flex-1 border rounded-xl py-2.5 text-sm transition-colors ${darkMode ? 'border-white/10 text-white/50 hover:bg-white/5' : 'border-stone-200 text-stone-500 hover:bg-stone-50'}`}>
                    ← Back
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={loading || (files.length === 0 && pendingUploads.length === 0)}
                  className="flex-[2] bg-[#1c1c1e] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40"
                >
                  {loading
                    ? progress
                      ? `Uploading ${progress.done} of ${progress.total}...`
                      : 'Uploading...'
                    : 'Submit documents'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Success */}
          {step === 3 && (
            <div className={`${cardBg} border ${borderColor} rounded-2xl p-10 text-center border-t-2 border-t-emerald-500`}>
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
                <svg className="w-7 h-7 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className={`text-lg font-medium mb-2 ${textPrimary}`}>Documents submitted!</h2>
              <p className={`text-sm leading-relaxed ${textSecondary}`}>Your accountant will review everything shortly. You can return to this page anytime to add more documents.</p>
            </div>
          )}

        </div>

        <p className={`text-center text-xs mt-5 ${textTertiary}`}>
          Your files are sent over an encrypted connection and are only accessible to your accountant&apos;s team.
        </p>
      </div>
    </main>
  )
}
