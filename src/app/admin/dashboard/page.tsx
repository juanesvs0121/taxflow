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
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    if (!profileData) return
    setProfile(profileData)

    // Si es member, solo sus clientes asignados
    let clientQuery = supabase.from('clients').select('*')
    if (profileData.role === 'member') {
      clientQuery = clientQuery.eq('assigned_to', profileData.full_name)
    }

    const { data: clients } = await clientQuery
    const activeClients = clients?.filter(c => !c.archived) || []
    const archivedClients = clients?.filter(c => c.archived) || []

    // Documentos solo de sus clientes
    let documentCount = 0
    if (activeClients.length > 0) {
      const ids = activeClients.map(c => c.id)
      const { data: docs } = await supabase
        .from('documents')
        .select('id')
        .in('client_id', ids)
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
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    window.location.href = '/admin/login'
  }

  const statusColor = (status: string) => {
    if (status === 'complete') return 'bg-green-100 text-green-700'
    if (status === 'in_progress') return 'bg-yellow-100 text-yellow-700'
    return 'bg-red-100 text-red-700'
  }

  const statusLabel = (status: string) => {
    if (status === 'complete') return 'Complete'
    if (status === 'in_progress') return 'In progress'
    return 'Pending'
  }

  const bg = darkMode ? 'bg-gray-900' : 'bg-gray-50'
  const card = darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'
  const text = darkMode ? 'text-gray-100' : 'text-gray-800'
  const subtext = darkMode ? 'text-gray-400' : 'text-gray-500'

  if (!mounted || loading) {
    return (
      <main className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </main>
    )
  }

  return (
    <main className={`min-h-screen ${bg} transition-colors duration-300`}>
      {/* Nav */}
      <div className={`flex items-center justify-between px-6 py-3 border-b ${darkMode ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-600" />
          <span className={`text-sm font-medium ${text}`}>TaxFlow</span>
          <span className={`text-xs ml-2 px-2 py-0.5 rounded-full ${darkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-100 text-gray-500'}`}>
            Dashboard
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs ${subtext}`}>{profile?.full_name}</span>
          <button
            onClick={() => router.push('/admin')}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition"
          >
            Go to panel →
          </button>
          <button
            onClick={() => {
              const next = !darkMode
              setDarkMode(next)
              localStorage.setItem('darkMode', String(next))
            }}
            className={`p-1.5 rounded-lg border ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'} transition`}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button
            onClick={handleLogout}
            className={`text-xs px-3 py-1.5 rounded-lg border transition ${darkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}
          >
            Sign out
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className={`text-2xl font-semibold ${text}`}>
            {profile?.role === 'admin' ? 'Overview' : `My Overview`}
          </h1>
          <p className={`text-sm ${subtext} mt-1`}>
            {profile?.role === 'admin'
              ? "Here's what's happening with your clients."
              : "Here's a summary of your assigned clients."}
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: profile?.role === 'admin' ? 'Active clients' : 'My active clients', value: stats.total, color: 'text-blue-600', bg: 'bg-blue-50' },
            { label: 'Documents received', value: stats.documents, color: 'text-purple-600', bg: 'bg-purple-50' },
            { label: 'Archived', value: stats.archived, color: 'text-gray-500', bg: darkMode ? 'bg-gray-700' : 'bg-gray-100' },
          ].map(s => (
            <div key={s.label} className={`${card} border rounded-2xl p-6`}>
              <div className={`w-10 h-10 ${s.bg} rounded-xl flex items-center justify-center mb-4`}>
                <span className={`text-lg font-bold ${s.color}`}>{s.value}</span>
              </div>
              <p className={`text-2xl font-semibold ${text}`}>{s.value}</p>
              <p className={`text-xs ${subtext} mt-1`}>{s.label}</p>
            </div>
          ))}
        </div>

        {/* Status breakdown */}
        <div className={`${card} border rounded-2xl p-6 mb-6`}>
          <p className={`text-xs font-medium ${subtext} uppercase tracking-wider mb-4`}>Status breakdown</p>
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Pending', value: stats.pending, color: 'bg-red-500', light: 'bg-red-100 text-red-700' },
              { label: 'In progress', value: stats.in_progress, color: 'bg-yellow-500', light: 'bg-yellow-100 text-yellow-700' },
              { label: 'Complete', value: stats.complete, color: 'bg-green-500', light: 'bg-green-100 text-green-700' },
            ].map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${s.color} flex-shrink-0`} />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-xs ${subtext}`}>{s.label}</span>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${s.light}`}>{s.value}</span>
                  </div>
                  <div className={`h-1.5 rounded-full ${darkMode ? 'bg-gray-700' : 'bg-gray-100'}`}>
                    <div
                      className={`h-1.5 rounded-full ${s.color} transition-all duration-500`}
                      style={{ width: stats.total > 0 ? `${(s.value / stats.total) * 100}%` : '0%' }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent clients */}
        <div className={`${card} border rounded-2xl p-6`}>
          <div className="flex items-center justify-between mb-4">
            <p className={`text-xs font-medium ${subtext} uppercase tracking-wider`}>
              {profile?.role === 'admin' ? 'Recent clients' : 'My recent clients'}
            </p>
            <button onClick={() => router.push('/admin')} className="text-xs text-blue-500 hover:text-blue-700 transition">
              View all →
            </button>
          </div>
          {recent.length === 0 ? (
            <p className={`text-sm ${subtext}`}>No clients yet.</p>
          ) : (
            recent.map(client => (
              <div key={client.id} className={`flex items-center gap-3 py-2.5 border-b ${darkMode ? 'border-gray-700' : 'border-gray-100'} last:border-0`}>
                <div className="w-7 h-7 bg-blue-100 rounded-full flex items-center justify-center text-xs font-medium text-blue-700 flex-shrink-0">
                  {client.first_name[0]}{client.last_name[0]}
                </div>
                <div className="flex-1">
                  <p className={`text-sm ${text}`}>{client.first_name} {client.last_name}</p>
                  <p className={`text-xs ${subtext}`}>{client.assigned_to || 'Unassigned'}</p>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColor(client.status)}`}>
                  {statusLabel(client.status)}
                </span>
                <span className={`text-xs ${subtext}`}>{new Date(client.created_at).toLocaleDateString()}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  )
}