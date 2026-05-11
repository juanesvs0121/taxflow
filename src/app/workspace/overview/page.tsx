'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

type Stats = {
  total: number
  pending: number
  in_progress: number
  complete: number
  archived: number
  documents: number
}

type RecentClient = {
  id: string
  first_name: string
  last_name: string
  status: string
  created_at: string
  assigned_to: string
}

type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'member'
}

export default function DashboardPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [stats, setStats] = useState<Stats>({ total: 0, pending: 0, in_progress: 0, complete: 0, archived: 0, documents: 0 })
  const [recent, setRecent] = useState<RecentClient[]>([])
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) setDarkMode(saved === 'true')
    setMounted(true)
  }, [])

  useEffect(() => { init() }, [])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    const { data: profileData } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (!profileData) return
    setProfile(profileData)

    let clientQuery = supabase.from('clients').select('*')
    if (profileData.role === 'member') {
      clientQuery = clientQuery.eq('assigned_to', profileData.full_name)
    }

    const { data: clients } = await clientQuery
    const activeClients = clients?.filter(c => !c.archived) || []
    const archivedClients = clients?.filter(c => c.archived) || []

    let documentCount = 0
    if (activeClients.length > 0) {
      const ids = activeClients.map(c => c.id)
      const { data: docs } = await supabase.from('documents').select('id').in('client_id', ids)
      documentCount = docs?.length || 0
    }

    setStats({
      total: activeClients.length,
      pending: activeClients.filter(c => c.status === 'pending').length,
      in_progress: activeClients.filter(c => c.status === 'in_progress').length,
      complete: activeClients.filter(c => c.status === 'complete').length,
      archived: archivedClients.length,
      documents: documentCount
    })

    setRecent(activeClients.slice(0, 5))
    setLoading(false)

    setTimeout(() => setVisible(true), 100)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/workspace/login'
  }

  const toggleDarkMode = () => {
    const next = !darkMode
    setDarkMode(next)
    localStorage.setItem('darkMode', String(next))
  }

  const statusBadge = (status: string) => {
    if (status === 'complete') return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    if (status === 'in_progress') return 'bg-blue-50 text-blue-700 border border-blue-200'
    return 'bg-amber-50 text-amber-700 border border-amber-200'
  }

  const statusLabel = (status: string) => {
    if (status === 'complete') return 'Complete'
    if (status === 'in_progress') return 'In progress'
    return 'Pending'
  }

  const avatarColors = [
    'bg-violet-100 text-violet-600',
    'bg-sky-100 text-sky-600',
    'bg-emerald-100 text-emerald-600',
    'bg-amber-100 text-amber-600',
    'bg-rose-100 text-rose-600',
  ]

  const bg = darkMode ? 'bg-[#0f0f0f]' : 'bg-[#fafaf8]'
  const panelBg = darkMode ? 'bg-[#161616]' : 'bg-white'
  const cardBg = darkMode ? 'bg-[#1e1e1e]' : 'bg-[#fafaf8]'
  const borderColor = darkMode ? 'border-white/5' : 'border-stone-100'
  const textPrimary = darkMode ? 'text-white/90' : 'text-stone-800'
  const textSecondary = darkMode ? 'text-white/50' : 'text-stone-500'
  const textTertiary = darkMode ? 'text-white/30' : 'text-stone-400'
  const btnBorder = darkMode ? 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10' : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'
  const hoverBg = darkMode ? 'hover:bg-white/5' : 'hover:bg-stone-50'

  if (!mounted || loading) {
    return (
      <main className={`min-h-screen ${bg} flex items-center justify-center transition-colors duration-300`}>
        <p className={`text-sm ${textSecondary}`}>Loading...</p>
      </main>
    )
  }

  const completionRate = stats.total > 0 ? Math.round((stats.complete / stats.total) * 100) : 0

  return (
    <main className={`min-h-screen ${bg} flex flex-col transition-colors duration-300`}>

      {/* Topbar */}
      <div className={`flex items-center justify-between px-5 py-3 ${panelBg} border-b ${borderColor} transition-colors duration-300`}>
        <div className="flex items-center gap-2.5">
          <span className={`text-sm font-medium tracking-tight ${textPrimary}`}>
            Tax<span className="text-emerald-500">Flow</span>
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-md ${darkMode ? 'bg-white/5 text-white/30' : 'bg-stone-100 text-stone-400'}`}>
            Dashboard
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${textSecondary}`}>{profile?.full_name}</span>
          <button onClick={() => router.push('/workspace')} className="text-xs px-3 py-1.5 rounded-lg bg-[#1c1c1e] text-white hover:bg-stone-800 transition-colors">
            Go to panel →
          </button>
          <button onClick={toggleDarkMode} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${btnBorder}`}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={handleLogout} className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${btnBorder}`}>
            Sign out
          </button>
        </div>
      </div>

      <div className={`max-w-4xl mx-auto w-full px-6 py-8 transition-all duration-500 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>

        {/* Header */}
        <div className="mb-8">
          <h1 className={`text-2xl font-medium tracking-tight mb-1 ${textPrimary}`}>
            {profile?.role === 'admin' ? 'Overview' : 'My overview'}
          </h1>
          <p className={`text-sm ${textSecondary}`}>
            {profile?.role === 'admin' ? "Here's what's happening with your clients." : "A summary of your assigned clients."}
          </p>
        </div>

        {/* Top stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          {[
            { label: profile?.role === 'admin' ? 'Active clients' : 'My clients', value: stats.total, accent: 'border-t-emerald-500', num: 'text-emerald-600' },
            { label: 'Documents received', value: stats.documents, accent: 'border-t-blue-500', num: 'text-blue-600' },
            { label: 'Archived', value: stats.archived, accent: 'border-t-stone-400', num: darkMode ? 'text-white/50' : 'text-stone-400' },
          ].map((s, i) => (
            <div
              key={s.label}
              className={`${panelBg} border ${borderColor} rounded-2xl p-5 border-t-2 ${s.accent} transition-all duration-500`}
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <p className={`text-[10px] font-medium uppercase tracking-widest mb-3 ${textTertiary}`}>{s.label}</p>
              <p className={`text-3xl font-medium tracking-tight ${s.num}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {/* Completion rate + breakdown */}
        <div className="grid grid-cols-3 gap-4 mb-6">

          {/* Completion rate */}
          <div className={`${panelBg} border ${borderColor} rounded-2xl p-5 border-l-2 border-l-emerald-500 transition-colors duration-300`}>
            <p className={`text-[10px] font-medium uppercase tracking-widest mb-3 ${textSecondary}`}>Completion rate</p>
            <p className={`text-3xl font-medium tracking-tight text-emerald-600 mb-3`}>{completionRate}%</p>
            <div className={`h-1.5 rounded-full ${darkMode ? 'bg-white/10' : 'bg-stone-100'} overflow-hidden`}>
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-1000"
                style={{ width: `${completionRate}%` }}
              />
            </div>
          </div>

          {/* Status breakdown */}
          <div className={`col-span-2 ${panelBg} border ${borderColor} rounded-2xl p-5 transition-colors duration-300`}>
            <p className={`text-[10px] font-medium uppercase tracking-widest mb-4 ${textSecondary}`}>Status breakdown</p>
            <div className="flex flex-col gap-3">
              {[
                { label: 'Pending', value: stats.pending, color: 'bg-amber-400', border: 'border-l-amber-400', text: 'text-amber-600' },
                { label: 'In progress', value: stats.in_progress, color: 'bg-blue-500', border: 'border-l-blue-500', text: 'text-blue-600' },
                { label: 'Complete', value: stats.complete, color: 'bg-emerald-500', border: 'border-l-emerald-500', text: 'text-emerald-600' },
              ].map(s => (
                <div key={s.label} className={`flex items-center gap-3 pl-2 border-l-2 ${s.border}`}>
                  <span className={`text-xs w-20 flex-shrink-0 ${textSecondary}`}>{s.label}</span>
                  <div className={`flex-1 h-1.5 rounded-full ${darkMode ? 'bg-white/10' : 'bg-stone-100'} overflow-hidden`}>
                    <div
                      className={`h-full rounded-full ${s.color} transition-all duration-1000`}
                      style={{ width: stats.total > 0 ? `${(s.value / stats.total) * 100}%` : '0%' }}
                    />
                  </div>
                  <span className={`text-xs font-medium w-4 text-right ${s.text}`}>{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Recent clients */}
        <div className={`${panelBg} border ${borderColor} rounded-2xl overflow-hidden border-t-2 border-t-stone-300 transition-colors duration-300`}>
          <div className={`flex items-center justify-between px-5 py-3.5 border-b ${borderColor}`}>
            <p className={`text-[10px] font-medium uppercase tracking-widest ${textSecondary}`}>
              {profile?.role === 'admin' ? 'Recent clients' : 'My recent clients'}
            </p>
            <button onClick={() => router.push('/admin')} className={`text-[10px] font-medium transition-colors text-emerald-600 hover:text-emerald-800`}>
              View all →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className={`text-xs px-5 py-6 ${textSecondary}`}>No clients yet.</p>
          ) : (
            recent.map((client, i) => (
              <div
                key={client.id}
                className={`flex items-center gap-3 px-5 py-3 ${hoverBg} transition-all duration-300 border-l-2 ${
                  client.status === 'complete' ? 'border-l-emerald-500' :
                  client.status === 'in_progress' ? 'border-l-blue-500' : 'border-l-amber-400'
                } ${i > 0 ? `border-t ${borderColor}` : ''}`}
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium flex-shrink-0 ${avatarColors[i % avatarColors.length]}`}>
                  {client.first_name[0]}{client.last_name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-medium capitalize ${textPrimary}`}>{client.first_name} {client.last_name}</p>
                  <p className={`text-[10px] ${textSecondary}`}>{client.assigned_to || 'Unassigned'}</p>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${statusBadge(client.status)}`}>
                  {statusLabel(client.status)}
                </span>
                <span className={`text-[10px] ${textTertiary} ml-2`}>
                  {new Date(client.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              </div>
            ))
          )}
        </div>

      </div>
    </main>
  )
}