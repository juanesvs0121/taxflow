'use client'

import { useState, useCallback, useEffect } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { useDropzone } from 'react-dropzone'

export default function ClientPage() {
  const { token } = useParams()
  const [step, setStep] = useState(1)
  const [animating, setAnimating] = useState(false)
  const [loading, setLoading] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [darkMode, setDarkMode] = useState(false)
  const [checking, setChecking] = useState(true)
  const [isReturning, setIsReturning] = useState(false)
  const [verifyInput, setVerifyInput] = useState('')
  const [verified, setVerified] = useState(false)
  const [existingClientId, setExistingClientId] = useState<string | null>(null)
  const [existingClientData, setExistingClientData] = useState<Record<string, unknown> | null>(null)
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

  useEffect(() => {
    const checkToken = async () => {
      const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('token', token)
        .maybeSingle()

      if (data) {
        setIsReturning(true)
        setExistingClientId(data.id)
        setExistingClientData(data)
      }
      setChecking(false)
    }
    checkToken()
  }, [token])

  const goToStep = (next: number) => {
    setAnimating(true)
    setTimeout(() => {
      setStep(next)
      setAnimating(false)
    }, 300)
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: useCallback((accepted: File[]) => {
      setFiles(prev => [...prev, ...accepted])
    }, [])
  })

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handleVerify = async () => {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('token', token)
      .or(`email.eq.${verifyInput},phone.eq.${verifyInput}`)
      .maybeSingle()

    if (data) {
      setVerified(true)
      setExistingClientId(data.id)
      setExistingClientData(data)
      goToStep(2)
    } else {
      alert('We could not verify your identity. Please check your email or phone number.')
    }
  }

  const handleSubmit = async () => {
    if (files.length === 0) return
    setLoading(true)

    try {
      let clientId = existingClientId
      let clientData: Record<string, unknown> = form

      if (!clientId) {
        const { data, error } = await supabase
          .from('clients')
          .insert([{ ...form, token, fiscal_year: parseInt(form.fiscal_year) }])
          .select()
          .single()

        if (error) throw error
        clientId = data.id
        clientData = data
      } else if (existingClientData) {
        clientData = existingClientData
      }

      let uploadedCount = 0
      for (const file of files) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${clientId}/${Date.now()}_${safeName}`
        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(path, file)

        if (!uploadError) {
          await supabase.from('documents').insert([{
            client_id: clientId,
            file_name: file.name,
            file_path: path
          }])
          uploadedCount++
        }
      }

      if (uploadedCount > 0) {
        await fetch('/api/notify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            clientName: `${clientData.first_name} ${clientData.last_name}`,
            fileCount: uploadedCount,
            state: clientData.state,
            fiscalYear: clientData.fiscal_year,
            assignedTo: clientData.assigned_to,
            token
          })
        })
      }

      goToStep(3)
    } catch {
      alert('Error submitting your information. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const bg = darkMode ? 'bg-gray-900' : 'bg-gray-50'
  const card = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const text = darkMode ? 'text-gray-100' : 'text-gray-800'
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500'
  const label = darkMode ? 'text-gray-300' : 'text-gray-600'
  const input = darkMode
    ? 'bg-gray-700 border-gray-600 text-gray-100 placeholder-gray-400'
    : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400'

  if (checking) {
    return (
      <main className={`min-h-screen ${bg} flex items-center justify-center`}>
        <p className={`text-sm ${subtext}`}>Loading...</p>
      </main>
    )
  }

  return (
    <main className={`min-h-screen ${bg} py-10 px-4 transition-colors duration-300`}>
      <div className="max-w-xl mx-auto">

        <div className="flex items-center justify-between mb-8">
          <div className="text-center flex-1">
            <h1 className={`text-2xl font-semibold ${text}`}>Submit your documents</h1>
            <p className={`${subtext} text-sm mt-1`}>Fill in your details and upload your files. Simple and secure.</p>
          </div>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`ml-4 p-2 rounded-lg border ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'} transition`}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>

        {!isReturning && step < 3 && (
          <>
            <div className={`w-full ${darkMode ? 'bg-gray-700' : 'bg-gray-200'} rounded-full h-1.5 mb-1`}>
              <div
                className="bg-blue-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: step === 1 ? '50%' : '100%' }}
              />
            </div>
            <p className={`text-xs ${subtext} text-right mb-6`}>Step {step} of 2</p>
          </>
        )}

        <div className={`transition-all duration-300 ${animating ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}>

          {isReturning && !verified && (
            <div className={`${card} border rounded-2xl p-6`}>
              <p className={`text-sm font-medium ${text} mb-1`}>Welcome back!</p>
              <p className={`text-xs ${subtext} mb-4`}>Enter your email or phone number to access your file.</p>
              <input
                value={verifyInput}
                onChange={e => setVerifyInput(e.target.value)}
                placeholder="Email or phone number"
                className={`w-full border rounded-lg px-3 py-2 text-sm mb-3 ${input}`}
              />
              <button
                onClick={handleVerify}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition"
              >
                Verify identity
              </button>
            </div>
          )}

          {!isReturning && step === 1 && (
            <div className={`${card} border rounded-2xl p-6`}>
              <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-4`}>Personal information</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>First name</label>
                  <input name="first_name" value={form.first_name} onChange={handleChange} placeholder="John" className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`} />
                </div>
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>Last name</label>
                  <input name="last_name" value={form.last_name} onChange={handleChange} placeholder="Smith" className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>Email</label>
                  <input name="email" value={form.email} onChange={handleChange} placeholder="john@email.com" className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`} />
                </div>
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>Phone</label>
                  <input name="phone" value={form.phone} onChange={handleChange} placeholder="+1 555 000 0000" className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>State of residence</label>
                  <select name="state" value={form.state} onChange={handleChange} className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`}>
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
                <div>
                  <label className={`text-xs ${label} mb-1 block`}>Tax year</label>
                  <select name="fiscal_year" value={form.fiscal_year} onChange={handleChange} className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`}>
                    <option>2025</option>
                    <option>2024</option>
                    <option>2023</option>
                  </select>
                </div>
              </div>
              <div className="mb-4">
                <label className={`text-xs ${label} mb-1 block`}>Marital status</label>
                <select name="marital_status" value={form.marital_status} onChange={handleChange} className={`w-full border rounded-lg px-3 py-2 text-sm ${input}`}>
                  <option value="">Select...</option>
                  <option>Single</option>
                  <option>Married (joint return)</option>
                  <option>Married (separate return)</option>
                  <option>Head of household</option>
                </select>
              </div>
              <button
                onClick={() => goToStep(2)}
                disabled={!form.first_name || !form.last_name || !form.email}
                className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40"
              >
                Continue →
              </button>
            </div>
          )}

          {((!isReturning && step === 2) || (isReturning && verified && step === 2)) && (
            <div className={`${card} border rounded-2xl p-6`}>
              <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-4`}>Upload your files</p>
              <div
                {...getRootProps()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition mb-4 ${
                  isDragActive
                    ? 'border-blue-400 bg-blue-50'
                    : darkMode
                    ? 'border-gray-600 hover:bg-gray-700'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
              >
                <input {...getInputProps()} />
                <p className={`text-sm ${subtext}`}>
                  <span className="text-blue-500 font-medium">Click here</span> or drag your files
                </p>
                <p className={`text-xs mt-1 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>Any file type · Max 20MB per file</p>
              </div>

              {files.length > 0 && (
                <div className="mb-4">
                  <p className={`text-xs ${subtext} mb-2`}>{files.length} file(s) selected</p>
                  {files.map((f, i) => (
                    <div key={i} className={`flex items-center justify-between text-xs py-1.5 border-b ${darkMode ? 'border-gray-700 text-gray-300' : 'border-gray-100 text-gray-600'}`}>
                      <span>{f.name}</span>
                      <button onClick={() => setFiles(files.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-500 ml-4">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              <div className="mb-4">
                <label className={`text-xs ${label} mb-1 block`}>Notes for your accountant (optional)</label>
                <textarea
                  name="notes"
                  value={form.notes}
                  onChange={handleChange}
                  rows={3}
                  placeholder="Ex: The March receipt is from the dentist..."
                  className={`w-full border rounded-lg px-3 py-2 text-sm resize-none ${input}`}
                />
              </div>

              <div className="flex gap-3">
                {!isReturning && (
                  <button
                    onClick={() => goToStep(1)}
                    className={`flex-1 border rounded-lg py-2.5 text-sm transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                  >
                    ← Back
                  </button>
                )}
                <button
                  onClick={handleSubmit}
                  disabled={loading || files.length === 0}
                  className="flex-[2] bg-blue-600 text-white rounded-lg py-2.5 text-sm font-medium hover:bg-blue-700 transition disabled:opacity-40"
                >
                  {loading ? 'Uploading...' : 'Submit documents'}
                </button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className={`${card} border rounded-2xl p-8 text-center`}>
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className={`text-lg font-semibold ${text} mb-2`}>Documents submitted!</h2>
              <p className={`text-sm ${subtext}`}>Your accountant will review everything shortly. You can return to this page anytime to add more documents.</p>
            </div>
          )}

        </div>

        <p className={`text-center text-xs mt-4 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
          Your files are encrypted and only your accountant can access them.
        </p>
      </div>
    </main>
  )
}