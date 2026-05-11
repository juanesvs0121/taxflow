'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { Client, Document } from '@/lib/supabase'

type InternalNote = {
  id: string
  client_id: string
  author: string
  content: string
  created_at: string
}

type Profile = {
  id: string
  full_name: string
  role: 'admin' | 'member'
}

const TEAM_MEMBERS = ['Unassigned', 'Admin', 'Team Member 1', 'Team Member 2']

export default function AdminPage() {
  const router = useRouter()
  const [profile, setProfile] = useState<Profile | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [notes, setNotes] = useState<InternalNote[]>([])
  const [selected, setSelected] = useState<Client | null>(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const [newNote, setNewNote] = useState('')
  const [showArchive, setShowArchive] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState<Client | null>(null)
  const [notification, setNotification] = useState<string | null>(null)
  const [confirmDeleteClient, setConfirmDeleteClient] = useState<Client | null>(null)
  const [confirmDeleteDoc, setConfirmDeleteDoc] = useState<Document | null>(null)
  const [panelVisible, setPanelVisible] = useState(false)

  // MOBILE: controls whether the sidebar drawer is open on small screens
  const [sidebarOpen, setSidebarOpen] = useState(false)
  // MOBILE: tracks if we're showing the detail panel (hides client list on mobile)
  const [mobileShowDetail, setMobileShowDetail] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('darkMode')
    if (saved !== null) setDarkMode(saved === 'true')
    setMounted(true)
  }, [])

  useEffect(() => { init() }, [])

  useEffect(() => {
    if (!profile) return
    const channel = supabase
      .channel('documents-changes')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'documents' },
        async (payload) => {
          const { data: client } = await supabase
            .from('clients')
            .select('first_name, last_name')
            .eq('id', payload.new.client_id)
            .single()
          if (client) {
            setNotification(`${client.first_name} ${client.last_name} just uploaded a new file`)
            setTimeout(() => setNotification(null), 5000)
            await fetchClients(profile)
          }
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile])

  const init = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: profileData } = await supabase
      .from('profiles').select('*').eq('id', user.id).single()
    if (profileData) {
      setProfile(profileData)
      await fetchClients(profileData)
    }
    setLoading(false)
  }

  const fetchClients = async (p: Profile) => {
    let query = supabase.from('clients').select('*').order('created_at', { ascending: false })
    if (p.role === 'member') query = query.eq('assigned_to', p.full_name)
    const { data } = await query
    if (data) setClients(data)
  }

  const fetchDocuments = async (clientId: string) => {
    const { data } = await supabase.from('documents').select('*').eq('client_id', clientId).order('uploaded_at', { ascending: false })
    if (data) setDocuments(data)
  }

  const fetchNotes = async (clientId: string) => {
    const { data } = await supabase.from('internal_notes').select('*').eq('client_id', clientId).order('created_at', { ascending: true })
    if (data) setNotes(data)
  }

  const selectClient = (client: Client) => {
    setPanelVisible(false)
    setSidebarOpen(false)
    setTimeout(() => {
      setSelected(client)
      fetchDocuments(client.id)
      fetchNotes(client.id)
      setPanelVisible(true)
      setMobileShowDetail(true)
    }, 150)
  }

  const handleMobileBack = () => {
    setMobileShowDetail(false)
    setSelected(null)
    setPanelVisible(false)
  }

  const updateStatus = async (status: string) => {
    if (!selected) return
    await supabase.from('clients').update({ status }).eq('id', selected.id)
    const updated = { ...selected, status: status as Client['status'] }
    setSelected(updated)
    setClients(clients.map(c => c.id === selected.id ? updated : c))
  }

  const updateAssignee = async (assigned_to: string) => {
    if (!selected) return
    await supabase.from('clients').update({ assigned_to }).eq('id', selected.id)
    const updated = { ...selected, assigned_to }
    setSelected(updated)
    setClients(clients.map(c => c.id === selected.id ? updated : c))
  }

  const addNote = async () => {
    if (!newNote.trim() || !selected || !profile) return
    const { data } = await supabase
      .from('internal_notes')
      .insert([{ client_id: selected.id, author: profile.full_name, content: newNote.trim() }])
      .select().single()
    if (data) setNotes([...notes, data])
    setNewNote('')
  }

  const handleArchiveClick = (e: React.MouseEvent, client: Client) => {
    e.stopPropagation()
    if (client.status === 'complete') archiveClient(client)
    else setConfirmArchive(client)
  }

  const archiveClient = async (client: Client) => {
    await supabase.from('clients').update({ archived: true }).eq('id', client.id)
    setClients(clients.map(c => c.id === client.id ? { ...c, archived: true } : c))
    if (selected?.id === client.id) {
      setSelected(null)
      setPanelVisible(false)
      setMobileShowDetail(false)
    }
    setConfirmArchive(null)
  }

  const unarchiveClient = async (client: Client) => {
    await supabase.from('clients').update({ archived: false }).eq('id', client.id)
    setClients(clients.map(c => c.id === client.id ? { ...c, archived: false } : c))
  }

  const deleteClient = async (client: Client) => {
    await supabase.storage.from('documents').list(client.id).then(async ({ data }) => {
      if (data && data.length > 0) {
        const paths = data.map(f => `${client.id}/${f.name}`)
        await supabase.storage.from('documents').remove(paths)
      }
    })
    await supabase.from('clients').delete().eq('id', client.id)
    setClients(clients.filter(c => c.id !== client.id))
    if (selected?.id === client.id) {
      setSelected(null)
      setPanelVisible(false)
      setMobileShowDetail(false)
    }
    setConfirmDeleteClient(null)
  }

  const deleteDocument = async (doc: Document) => {
    await supabase.storage.from('documents').remove([doc.file_path])
    await supabase.from('documents').delete().eq('id', doc.id)
    setDocuments(documents.filter(d => d.id !== doc.id))
    setConfirmDeleteDoc(null)
  }

  const getDownloadUrl = async (path: string) => {
    const { data } = await supabase.storage.from('documents').createSignedUrl(path, 60)
    if (data) window.open(data.signedUrl, '_blank')
  }

  const generateClientLink = () => {
  const token = Math.random().toString(36).substring(2, 10)
  const url = `${window.location.origin}/s/${token}`
  navigator.clipboard.writeText(url)
  alert(`Link copied!\n\n${url}`)
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

  const activeClients = clients.filter(c => !c.archived)
  const archivedClients = clients.filter(c => c.archived)

  const filteredClients = (showArchive ? archivedClients : activeClients).filter(c => {
    const matchesSearch = `${c.first_name} ${c.last_name}`.toLowerCase().includes(search.toLowerCase())
    const matchesFilter = filter === 'all' || c.status === filter
    return matchesSearch && matchesFilter
  })

  const statusLabel = (status: string) => {
    if (status === 'complete') return 'Complete'
    if (status === 'in_progress') return 'In progress'
    return 'Pending'
  }

  const statusBadge = (status: string) => {
    if (status === 'complete') return 'bg-emerald-50 text-emerald-700 border border-emerald-200'
    if (status === 'in_progress') return 'bg-blue-50 text-blue-700 border border-blue-200'
    return 'bg-amber-50 text-amber-700 border border-amber-200'
  }

  const statusDot = (status: string) => {
    if (status === 'complete') return 'bg-emerald-500'
    if (status === 'in_progress') return 'bg-blue-500'
    return 'bg-amber-400'
  }

  const accentBorder = (status: string) => {
    if (status === 'complete') return 'border-l-emerald-500'
    if (status === 'in_progress') return 'border-l-blue-500'
    return 'border-l-amber-400'
  }

  const accentText = (status: string) => {
    if (status === 'complete') return 'text-emerald-600'
    if (status === 'in_progress') return 'text-blue-600'
    return 'text-amber-600'
  }

  const avatarColors = [
    'bg-violet-100 text-violet-600',
    'bg-sky-100 text-sky-600',
    'bg-emerald-100 text-emerald-600',
    'bg-amber-100 text-amber-600',
    'bg-rose-100 text-rose-600',
  ]

  const initials = (c: Client) => `${c.first_name[0]}${c.last_name[0]}`.toUpperCase()

  const formatDateUS = (dateString: string) => {
    const d = new Date(dateString)
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
  }

  const bg = darkMode ? 'bg-[#0f0f0f]' : 'bg-[#fafaf8]'
  const sidebarBg = darkMode ? 'bg-[#161616]' : 'bg-white'
  const panelBg = darkMode ? 'bg-[#161616]' : 'bg-white'
  const cardBg = darkMode ? 'bg-[#1e1e1e]' : 'bg-[#fafaf8]'
  const borderColor = darkMode ? 'border-white/5' : 'border-stone-100'
  const textPrimary = darkMode ? 'text-white/90' : 'text-stone-800'
  const textSecondary = darkMode ? 'text-white/40' : 'text-stone-500'
  const textTertiary = darkMode ? 'text-white/20' : 'text-stone-400'
  const inputBg = darkMode ? 'bg-white/5 text-white/70 placeholder-white/20' : 'bg-[#fafaf8] text-stone-600 placeholder-stone-400'
  const hoverBg = darkMode ? 'hover:bg-white/5' : 'hover:bg-stone-50'
  const btnBorder = darkMode ? 'border-white/10 bg-white/5 text-white/50 hover:bg-white/10' : 'border-stone-200 bg-white text-stone-500 hover:bg-stone-50'

  if (!mounted || loading) {
    return (
      <main className={`min-h-screen ${bg} flex items-center justify-center transition-colors duration-300`}>
        <p className={`text-sm ${textSecondary}`}>Loading...</p>
      </main>
    )
  }

  const modalBase = "fixed inset-0 bg-black/30 backdrop-blur-sm flex items-center justify-center z-50"
  const modalCard = darkMode
    ? "bg-[#1e1e1e] border border-white/10 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl"
    : "bg-white border border-stone-100 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-xl"

  const SidebarContent = () => (
    <>
      <div className="p-3 pb-2">
        <p className={`text-[10px] font-medium uppercase tracking-widest mb-2.5 ${textSecondary}`}>Clients</p>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name..."
          className={`w-full border-none rounded-lg px-3 py-1.5 text-xs outline-none ${inputBg} ${darkMode ? 'bg-white/5' : 'bg-[#fafaf8]'}`}
        />
      </div>

      {!showArchive && (
        <div className="flex gap-1 px-3 pb-2 flex-wrap">
          {['all', 'pending', 'in_progress', 'complete'].map(f => {
            const isActive = filter === f
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[10px] px-2.5 py-1 rounded-md font-medium border transition-all ${
                  isActive
                    ? f === 'pending'     ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : f === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : f === 'complete'    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : darkMode            ? 'bg-white/10 text-white border-transparent'
                    :                      'bg-[#1c1c1e] text-white border-transparent'
                    : `${textSecondary} border-transparent ${hoverBg}`
                }`}
              >
                {f === 'all' ? 'All' : f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            )
          })}
        </div>
      )}

      <p className={`text-[10px] px-3 pb-1.5 ${textSecondary}`}>
        {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
      </p>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filteredClients.map((client, i) => (
          <div
            key={client.id}
            onClick={() => selectClient(client)}
            className={`group flex items-center gap-2.5 px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 mb-0.5 border-l-2 ${
              selected?.id === client.id
                ? `${accentBorder(client.status)} ${darkMode ? 'bg-white/5' : client.status === 'complete' ? 'bg-emerald-50' : client.status === 'in_progress' ? 'bg-blue-50' : 'bg-amber-50'}`
                : `border-l-transparent ${hoverBg}`
            }`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-medium flex-shrink-0 ${avatarColors[i % avatarColors.length]}`}>
              {initials(client)}
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium truncate capitalize transition-colors ${textPrimary}`}>
                {client.first_name} {client.last_name}
              </p>
              <p className={`text-[10px] truncate ${textSecondary}`}>
                {client.assigned_to || 'Unassigned'}
              </p>
            </div>
            {showArchive ? (
              <button onClick={(e) => { e.stopPropagation(); unarchiveClient(client) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded" title="Restore">
                <svg className="w-3 h-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </button>
            ) : (
              <div className="flex items-center gap-0.5">
                <button onClick={(e) => handleArchiveClick(e, client)} className={`opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded ${hoverBg}`} title="Archive">
                  <svg className={`w-3 h-3 ${textTertiary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); setConfirmDeleteClient(client) }} className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-50" title="Delete">
                  <svg className="w-3 h-3 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ml-0.5 ${statusDot(client.status)}`} />
              </div>
            )}
          </div>
        ))}
        {filteredClients.length === 0 && (
          <p className={`text-xs text-center py-8 ${textTertiary}`}>
            {showArchive ? 'No archived clients' : 'No clients found'}
          </p>
        )}
      </div>

      <div className={`border-t ${borderColor}`}>
        <div className="flex">
          <button
            onClick={() => { setShowArchive(false); setSelected(null); setPanelVisible(false); setMobileShowDetail(false) }}
            className={`flex-1 py-2.5 text-xs transition-colors border-t-[1.5px] ${!showArchive ? `${textPrimary} font-medium border-stone-700` : `${textTertiary} border-transparent ${hoverBg}`}`}
          >
            Active
          </button>
          <button
            onClick={() => { setShowArchive(true); setSelected(null); setPanelVisible(false); setMobileShowDetail(false) }}
            className={`flex-1 py-2.5 text-xs transition-colors border-t-[1.5px] ${showArchive ? `${textPrimary} font-medium border-stone-700` : `${textTertiary} border-transparent ${hoverBg}`}`}
          >
            Archive {archivedClients.length > 0 && `(${archivedClients.length})`}
          </button>
        </div>
      </div>
    </>
  )

  const DetailPanel = () => {
    if (!selected) return null
    return (
      <div className={`flex-1 flex flex-col overflow-hidden transition-all duration-200 ${panelVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}`}>

        {/* Back button — mobile only */}
        <div className={`md:hidden flex items-center gap-2 px-4 py-2 ${panelBg} border-b ${borderColor}`}>
          <button
            onClick={handleMobileBack}
            className={`flex items-center gap-1.5 text-xs ${textSecondary} ${hoverBg} px-2 py-1.5 rounded-lg transition-colors`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Clients
          </button>
        </div>

        {/* Hero */}
        <div className={`${panelBg} border-b ${borderColor} px-4 md:px-6 py-4 border-l-4 ${accentBorder(selected.status)} transition-colors duration-500`}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className={`text-lg md:text-xl font-medium tracking-tight capitalize ${textPrimary}`}>
                {selected.first_name} {selected.last_name}
              </h2>
              <p className={`text-xs mt-0.5 ${textSecondary} hidden sm:block`}>
                {selected.email} · {selected.state} · {selected.marital_status} · {selected.phone}
              </p>
              <div className="sm:hidden flex flex-col gap-0.5 mt-1">
                <p className={`text-xs ${textSecondary}`}>{selected.email}</p>
                <p className={`text-xs ${textSecondary}`}>{selected.phone} · {selected.state} · {selected.marital_status}</p>
              </div>
            </div>
            <span className={`text-[10px] font-medium px-2.5 py-1 rounded-md flex-shrink-0 ml-2 ${statusBadge(selected.status)}`}>
              {statusLabel(selected.status)}
            </span>
          </div>

          {/* 2 cols mobile, 4 cols desktop */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {[
              { label: 'Documents', value: documents.length, accent: true },
              { label: 'Tax year', value: selected.fiscal_year },
              { label: 'Joined', value: formatDateUS(selected.created_at) },
            ].map(s => (
              <div key={s.label} className={`${cardBg} border ${borderColor} rounded-xl px-3 py-2.5 border-b-2 ${s.accent ? accentBorder(selected.status).replace('border-l-', 'border-b-') : 'border-b-transparent'} transition-colors duration-500`}>
                <p className={`text-[9px] font-medium uppercase tracking-widest mb-1 ${textSecondary}`}>{s.label}</p>
                <p className={`text-sm font-medium tracking-tight truncate ${s.accent ? accentText(selected.status) : textPrimary}`}>{s.value}</p>
              </div>
            ))}
            <div className={`${cardBg} border ${borderColor} rounded-xl px-3 py-2.5`}>
              <p className={`text-[9px] font-medium uppercase tracking-widest mb-1 ${textSecondary}`}>Assigned to</p>
              {profile?.role === 'admin' ? (
                <select
                  value={selected.assigned_to || 'Unassigned'}
                  onChange={e => updateAssignee(e.target.value)}
                  className={`text-sm font-medium bg-transparent border-none outline-none cursor-pointer w-full tracking-tight ${textPrimary}`}
                >
                  {TEAM_MEMBERS.map(m => <option key={m}>{m}</option>)}
                </select>
              ) : (
                <p className={`text-sm font-medium tracking-tight ${textPrimary}`}>{selected.assigned_to || 'Unassigned'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Scroll area */}
        <div className={`flex-1 overflow-y-auto px-4 md:px-6 py-4 flex flex-col gap-3 ${bg}`}>

          {/* Documents */}
          <div className={`${panelBg} border ${borderColor} rounded-2xl overflow-hidden border-t-2 ${accentBorder(selected.status).replace('border-l-', 'border-t-')} transition-colors duration-500`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
              <p className={`text-[10px] font-medium uppercase tracking-widest ${textSecondary}`}>Documents</p>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${statusBadge(selected.status)}`}>
                {documents.length} file{documents.length !== 1 ? 's' : ''}
              </span>
            </div>
            {documents.length === 0 ? (
              <p className={`text-xs px-4 py-4 ${textSecondary}`}>No documents uploaded yet.</p>
            ) : (
              documents.map((doc, i) => (
                <div key={doc.id} className={`flex items-center gap-3 px-4 py-2.5 ${hoverBg} transition-colors ${i > 0 ? `border-t ${borderColor}` : ''}`}>
                  <div className="w-7 h-7 bg-red-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <svg className="w-3.5 h-3.5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" strokeWidth={1.5} />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs truncate ${textPrimary}`}>{doc.file_name}</p>
                    <p className={`text-[10px] mt-0.5 ${textSecondary}`}>{formatDateUS(doc.uploaded_at)}</p>
                  </div>
                  <button onClick={() => getDownloadUrl(doc.file_path)} className={`text-[10px] font-medium transition-colors flex-shrink-0 ${accentText(selected.status)} hover:opacity-70`}>View</button>
                  <button onClick={() => setConfirmDeleteDoc(doc)} className="text-[10px] text-red-400 hover:text-red-600 transition-colors ml-2 flex-shrink-0">Delete</button>
                </div>
              ))
            )}
          </div>

          {/* Client notes */}
          {selected.notes && (
            <div className={`${panelBg} border ${borderColor} rounded-2xl px-4 py-3 border-l-2 ${accentBorder(selected.status)} transition-colors duration-500`}>
              <p className={`text-[10px] font-medium uppercase tracking-widest mb-2 ${textTertiary}`}>Client notes</p>
              <p className={`text-xs leading-relaxed ${textSecondary}`}>{selected.notes}</p>
            </div>
          )}

          {/* Internal notes */}
          <div className={`${panelBg} border ${borderColor} rounded-2xl overflow-hidden border-l-2 ${accentBorder(selected.status)} transition-colors duration-500`}>
            <div className={`px-4 py-3 border-b ${borderColor}`}>
              <p className={`text-[10px] font-medium uppercase tracking-widest ${textSecondary}`}>Internal notes</p>
            </div>
            <div className="max-h-44 overflow-y-auto">
              {notes.length === 0 ? (
                <p className={`text-xs px-4 py-4 ${textSecondary}`}>No notes yet.</p>
              ) : (
                notes.map((note, i) => (
                  <div
                    key={note.id}
                    className={`mx-4 my-2 ${cardBg} rounded-xl px-3 py-2.5 border-l-2 ${accentBorder(selected.status)} transition-colors duration-500`}
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[10px] font-medium ${textPrimary}`}>{note.author}</span>
                      <span className={`text-[10px] ${textSecondary}`}>{new Date(note.created_at).toLocaleDateString('en-US')}</span>
                    </div>
                    <p className={`text-xs leading-relaxed ${textSecondary}`}>{note.content}</p>
                  </div>
                ))
              )}
            </div>
            <div className={`flex gap-2 px-4 py-3 border-t ${borderColor}`}>
              <input
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addNote()}
                placeholder="Leave a note for the team..."
                className={`flex-1 border-none rounded-lg px-3 py-2 text-xs outline-none ${darkMode ? 'bg-white/5 text-white/90 placeholder-white/20' : 'bg-[#fafaf8] text-stone-600 placeholder-stone-400'}`}
              />
              <button
                onClick={addNote}
                disabled={!newNote.trim()}
                className="px-3 py-2 bg-[#1c1c1e] text-white text-xs rounded-lg hover:bg-stone-800 transition-colors disabled:opacity-40"
              >
                Add
              </button>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        {!showArchive && (
          <div className={`${panelBg} border-t ${borderColor} px-4 md:px-6 py-3 flex flex-wrap items-center gap-2 transition-colors duration-300`}>
            <button onClick={() => updateStatus('pending')} className={`px-3 py-2 text-xs border rounded-lg transition-colors ${btnBorder}`}>
              Mark pending
            </button>
            <button onClick={() => updateStatus('in_progress')} className="px-3 py-2 text-xs border border-blue-200 bg-blue-50 text-blue-700 rounded-lg hover:bg-blue-100 transition-colors">
              Mark active
            </button>
            <button onClick={() => updateStatus('complete')} className="px-3 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors md:ml-auto">
              Complete ✓
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <main className={`min-h-screen ${bg} flex flex-col transition-colors duration-300`}>

      {/* Notification */}
      {notification && (
        <div className="fixed bottom-6 right-4 left-4 sm:left-auto sm:right-6 sm:w-auto z-50 bg-[#1c1c1e] text-white text-xs px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
          <span className="flex-1">{notification}</span>
          <button onClick={() => setNotification(null)} className="text-white/40 hover:text-white transition-colors ml-1">✕</button>
        </div>
      )}

      {/* Modal archive */}
      {confirmArchive && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className={`text-sm font-medium mb-1 ${textPrimary}`}>Archive this client?</h3>
            <p className={`text-xs mb-5 ${textSecondary}`}>
              <strong className={textPrimary}>{confirmArchive.first_name} {confirmArchive.last_name}</strong> is currently <strong className={textPrimary}>{statusLabel(confirmArchive.status)}</strong>. Are you sure?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmArchive(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition-colors ${btnBorder}`}>Cancel</button>
              <button onClick={() => archiveClient(confirmArchive)} className="flex-1 px-4 py-2 text-xs bg-[#1c1c1e] text-white rounded-lg hover:bg-stone-800 transition-colors">Archive</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal delete client */}
      {confirmDeleteClient && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className={`text-sm font-medium mb-1 ${textPrimary}`}>Delete this client?</h3>
            <p className={`text-xs mb-5 ${textSecondary}`}>
              <strong className={textPrimary}>{confirmDeleteClient.first_name} {confirmDeleteClient.last_name}</strong> and all their documents will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteClient(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition-colors ${btnBorder}`}>Cancel</button>
              <button onClick={() => deleteClient(confirmDeleteClient)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal delete doc */}
      {confirmDeleteDoc && (
        <div className={modalBase}>
          <div className={modalCard}>
            <h3 className={`text-sm font-medium mb-1 ${textPrimary}`}>Delete this document?</h3>
            <p className={`text-xs mb-5 ${textSecondary}`}>
              <strong className={textPrimary}>{confirmDeleteDoc.file_name}</strong> will be permanently deleted.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmDeleteDoc(null)} className={`flex-1 px-4 py-2 text-xs border rounded-lg transition-colors ${btnBorder}`}>Cancel</button>
              <button onClick={() => deleteDocument(confirmDeleteDoc)} className="flex-1 px-4 py-2 text-xs bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className={`flex items-center justify-between px-4 md:px-5 py-3 ${sidebarBg} border-b ${borderColor} transition-colors duration-300`}>
        <div className="flex items-center gap-2.5">
          {/* Hamburger — mobile only */}
          <button
            onClick={() => setSidebarOpen(true)}
            className={`md:hidden p-1.5 rounded-lg border transition-colors ${btnBorder} mr-1`}
            aria-label="Open clients list"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className={`text-sm font-medium tracking-tight ${textPrimary}`}>
            Tax<span className="text-emerald-500">Flow</span>
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-md hidden sm:inline ${darkMode ? 'bg-white/5 text-white/30' : 'bg-stone-100 text-stone-400'}`}>
            {profile?.role === 'admin' ? 'Admin' : 'Member'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 md:gap-2">
          <span className={`text-xs ${textSecondary} hidden sm:inline`}>{profile?.full_name}</span>
          <button onClick={() => router.push('/workspace/overview')} className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${btnBorder}`}>
            <span className="hidden sm:inline">Dashboard</span>
            <svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>
          {profile?.role === 'admin' && (
            <button onClick={generateClientLink} className="text-xs px-2.5 py-1.5 rounded-lg bg-[#1c1c1e] text-white hover:bg-stone-800 transition-colors">
              <span className="hidden sm:inline">+ New link</span>
              <span className="sm:hidden">+</span>
            </button>
          )}
          <button onClick={toggleDarkMode} className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${btnBorder}`}>
            {darkMode ? '☀️' : '🌙'}
          </button>
          <button onClick={handleLogout} className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${btnBorder}`}>
            <span className="hidden sm:inline">Sign out</span>
            <svg className="w-3.5 h-3.5 sm:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <>
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
          <div className={`fixed top-0 left-0 bottom-0 w-72 ${sidebarBg} z-50 flex flex-col md:hidden shadow-2xl border-r ${borderColor}`}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${borderColor}`}>
              <span className={`text-sm font-medium ${textPrimary}`}>Clients</span>
              <button
                onClick={() => setSidebarOpen(false)}
                className={`p-1.5 rounded-lg border transition-colors ${btnBorder}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <SidebarContent />
          </div>
        </>
      )}

      <div className="flex flex-1 overflow-hidden">

        {/* Desktop sidebar */}
        <div className={`hidden md:flex w-60 ${sidebarBg} border-r ${borderColor} flex-col transition-colors duration-300`}>
          <SidebarContent />
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Mobile: client list (shown when no detail selected) */}
          {!mobileShowDetail && (
            <div className="flex-1 flex flex-col overflow-hidden md:hidden">
              <div className="flex-1 overflow-y-auto">
                <div className="p-3">
                  <p className={`text-[10px] font-medium uppercase tracking-widest mb-2.5 ${textSecondary}`}>Clients</p>
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search by name..."
                    className={`w-full border-none rounded-lg px-3 py-2 text-xs outline-none ${inputBg} ${darkMode ? 'bg-white/5' : 'bg-[#fafaf8]'}`}
                  />
                </div>
                {!showArchive && (
                  <div className="flex gap-1 px-3 pb-3 flex-wrap">
                    {['all', 'pending', 'in_progress', 'complete'].map(f => {
                      const isActive = filter === f
                      return (
                        <button
                          key={f}
                          onClick={() => setFilter(f)}
                          className={`text-[10px] px-2.5 py-1 rounded-md font-medium border transition-all ${
                            isActive
                              ? f === 'pending'     ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : f === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : f === 'complete'    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : darkMode            ? 'bg-white/10 text-white border-transparent'
                              :                      'bg-[#1c1c1e] text-white border-transparent'
                              : `${textSecondary} border-transparent ${hoverBg}`
                          }`}
                        >
                          {f === 'all' ? 'All' : f === 'in_progress' ? 'Active' : f.charAt(0).toUpperCase() + f.slice(1)}
                        </button>
                      )
                    })}
                  </div>
                )}
                <p className={`text-[10px] px-3 pb-2 ${textSecondary}`}>
                  {filteredClients.length} client{filteredClients.length !== 1 ? 's' : ''}
                </p>
                <div className="px-2 pb-24">
                  {filteredClients.map((client, i) => (
                    <div
                      key={client.id}
                      onClick={() => selectClient(client)}
                      className={`flex items-center gap-3 px-3 py-3 rounded-xl cursor-pointer transition-all duration-150 mb-1 ${hoverBg}`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-medium flex-shrink-0 ${avatarColors[i % avatarColors.length]}`}>
                        {initials(client)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium capitalize ${textPrimary}`}>
                          {client.first_name} {client.last_name}
                        </p>
                        <p className={`text-xs ${textSecondary}`}>{client.assigned_to || 'Unassigned'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-md ${statusBadge(client.status)}`}>
                          {statusLabel(client.status)}
                        </span>
                        <svg className={`w-4 h-4 ${textTertiary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className={`text-xs text-center py-12 ${textTertiary}`}>
                      {showArchive ? 'No archived clients' : 'No clients found'}
                    </p>
                  )}
                </div>
              </div>
              {/* Bottom tab bar */}
              <div className={`fixed bottom-0 left-0 right-0 ${sidebarBg} border-t ${borderColor} z-30`}>
                <div className="flex">
                  <button
                    onClick={() => { setShowArchive(false); setSelected(null); setPanelVisible(false) }}
                    className={`flex-1 py-3 text-xs transition-colors border-t-2 ${!showArchive ? `${textPrimary} font-medium border-stone-700` : `${textTertiary} border-transparent`}`}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => { setShowArchive(true); setSelected(null); setPanelVisible(false) }}
                    className={`flex-1 py-3 text-xs transition-colors border-t-2 ${showArchive ? `${textPrimary} font-medium border-stone-700` : `${textTertiary} border-transparent`}`}
                  >
                    Archive {archivedClients.length > 0 && `(${archivedClients.length})`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mobile: detail view */}
          {mobileShowDetail && selected && (
            <div className="flex-1 flex flex-col overflow-hidden md:hidden">
              <DetailPanel />
            </div>
          )}

          {/* Desktop: detail panel or empty state */}
          <div className="hidden md:flex flex-1 flex-col overflow-hidden">
            {selected ? (
              <DetailPanel />
            ) : (
              <div className={`flex-1 flex items-center justify-center ${bg}`}>
                <div className="text-center">
                  <div className={`w-10 h-10 rounded-xl ${darkMode ? 'bg-white/5' : 'bg-stone-100'} flex items-center justify-center mx-auto mb-3`}>
                    <svg className={`w-5 h-5 ${textTertiary}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </div>
                  <p className={`text-xs ${textTertiary}`}>
                    {showArchive ? 'Select an archived client' : 'Select a client to get started'}
                  </p>
                </div>
              </div>
            )}
          </div>

        </div>
      </div>
    </main>
  )
}