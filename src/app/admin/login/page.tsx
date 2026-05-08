'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState(false)
  const [darkMode, setDarkMode] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) setDarkMode(saved === 'true')
    setTimeout(() => setVisible(true), 80)
  }, [])

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('darkMode', String(next))
  }

  const handleLogin = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError('Invalid email or password. Please try again.')
      setLoading(false)
      return
    }
    window.location.href = '/admin'
  }

  const bg = darkMode ? 'bg-[#0f0f0f]' : 'bg-[#fafaf8]'
  const cardBg = darkMode ? 'bg-[#161616]' : 'bg-white'
  const borderColor = darkMode ? 'border-white/5' : 'border-stone-100'
  const textPrimary = darkMode ? 'text-white/90' : 'text-stone-800'
  const textSecondary = darkMode ? 'text-white/50' : 'text-stone-500'
  const inputClass = darkMode
    ? 'bg-white/5 border-white/10 text-white/90 placeholder-white/20 focus:border-emerald-500/50'
    : 'bg-[#fafaf8] border-stone-200 text-stone-800 placeholder-stone-300 focus:border-emerald-400'

  return (
    <main className={`min-h-screen ${bg} flex flex-col items-center justify-center px-4 transition-colors duration-300`}>

      {/* Dark mode toggle */}
      <div className="absolute top-4 right-4">
        <button
          onClick={toggleDarkMode}
          className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${darkMode ? 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10' : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'}`}
        >
          {darkMode ? '☀️' : '🌙'}
        </button>
      </div>

      <div className={`w-full max-w-sm transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

        {/* Logo */}
        <div className="text-center mb-8">
          <span className={`text-2xl font-medium tracking-tight ${textPrimary}`}>
            Tax<span className="text-emerald-500">Flow</span>
          </span>
          <p className={`text-xs mt-2 ${textSecondary}`}>Sign in to your account</p>
        </div>

        {/* Card */}
        <div className={`${cardBg} border ${borderColor} rounded-2xl p-6 border-t-2 border-t-emerald-500`}>

          <div className="mb-4">
            <label className={`text-[10px] font-medium uppercase tracking-widest block mb-2 ${textSecondary}`}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="admin@taxflow.com"
              className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none transition-colors ${inputClass}`}
            />
          </div>

          <div className="mb-5">
            <label className={`text-[10px] font-medium uppercase tracking-widest block mb-2 ${textSecondary}`}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLogin()}
              placeholder="••••••••"
              className={`w-full border rounded-xl px-3 py-2.5 text-sm outline-none transition-colors ${inputClass}`}
            />
          </div>

          {error && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-red-50 border border-red-100 border-l-2 border-l-red-400">
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}

          <button
            onClick={handleLogin}
            disabled={loading || !email || !password}
            className="w-full bg-[#1c1c1e] text-white rounded-xl py-2.5 text-sm font-medium hover:bg-stone-800 transition-colors disabled:opacity-40"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>

        <p className={`text-center text-xs mt-5 ${textSecondary}`}>
          Only authorized team members can access this panel.
        </p>
      </div>
    </main>
  )
}